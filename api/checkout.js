// api/checkout.js — Server-side endpoint that generates real Stripe checkout URLs
// Uses the user's access token to call OpenAI's internal checkout API

export default async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { accessToken, plan, country, currency } = req.body;
    if (!accessToken || !accessToken.startsWith('eyJ')) {
      return res.status(400).json({ error: 'Valid access token required (starts with eyJ...)', ok: false });
    }

    const plan_name = plan || 'chatgptplusplan';
    const billing_country = country || 'IN';
    const billing_currency = currency || 'INR';

    // Step 1: Call OpenAI's checkout API with the user's real access token
    const checkoutPayload = {
      plan_name: plan_name,
      billing_details: {
        country: billing_country,
        currency: billing_currency
      },
      promo_code: null,
      checkout_ui_mode: 'redirect',
      success_url: 'https://chatgpt.com/',
      cancel_url: 'https://chatgpt.com/'
    };

    console.log(`[checkout] Calling OpenAI API with plan=${plan_name}, country=${billing_country}, currency=${billing_currency}`);

    const checkoutRes = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/',
        'oai-language': 'en-US'
      },
      body: JSON.stringify(checkoutPayload)
    });

    const checkoutData = await checkoutRes.json();

    if (!checkoutRes.ok) {
      console.error('[checkout] OpenAI API error:', checkoutRes.status, JSON.stringify(checkoutData));
      return res.status(checkoutRes.status).json({
        error: 'OpenAI checkout failed',
        status: checkoutRes.status,
        details: checkoutData,
        ok: false
      });
    }

    // The response contains a Stripe-hosted checkout URL
    const checkoutUrl = checkoutData.url;
    if (!checkoutUrl || !checkoutUrl.startsWith('https://')) {
      return res.status(500).json({
        error: 'No valid checkout URL in response',
        data: checkoutData,
        ok: false
      });
    }

    console.log(`[checkout] Success! URL: ${checkoutUrl.substring(0, 80)}...`);

    return res.status(200).json({
      ok: true,
      url: checkoutUrl,
      amount: checkoutData.amount || 0,
      currency: checkoutData.currency || billing_currency,
      product_name: checkoutData.product_name || 'ChatGPT Plus'
    });

  } catch (error) {
    console.error('[checkout] Error:', error.message);
    return res.status(500).json({ error: error.message, ok: false });
  }
}
