// api/checkout.js
// This runs server-side on Vercel — it generates the REAL checkout URL using OpenAI's API

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { accessToken, plan_name, country, currency, promo_code } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    // Validate token format
    if (!accessToken.startsWith('eyJ')) {
      return res.status(400).json({ error: 'Invalid token format' });
    }

    // Build the payload for OpenAI's checkout API
    const payload = {
      plan_name: plan_name || 'chatgptplusplan',  // Default: ChatGPT Plus
      billing_details: {
        country: country || 'IN',
        currency: currency || 'INR'
      },
      promo_code: promo_code || null,
      checkout_ui_mode: 'redirect',
      cancel_url: 'https://chatgpt.com/',
      success_url: 'https://chatgpt.com/'
    };

    // For ChatGPT Go (₹0 trial India)
    // payload.plan_name = 'chatgptgoplan';
    
    // For Team plans with promo codes:
    // payload.plan_name = 'chatgptteamplan';
    // payload.team_plan_data = { workspace_name: 'Team...', price_interval: 'month', seat_quantity: 5 };
    // payload.promo_code = 'some-promo-code';

    console.log('Calling OpenAI checkout API with:', JSON.stringify(payload));

    const response = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'oai-language': 'en-US'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI API error:', response.status, data);
      return res.status(response.status).json({
        error: 'OpenAI checkout API failed',
        details: data,
        status: response.status
      });
    }

    // The response contains a URL like https://pay.openai.com/checkout/... or https://checkout.stripe.com/...
    if (!data || !data.url) {
      return res.status(500).json({
        error: 'No checkout URL in response',
        details: data
      });
    }

    return res.status(200).json({
      url: data.url,
      amount: data.amount || 0,
      currency: data.currency || currency || 'INR',
      product_name: data.product_name || 'ChatGPT Plus'
    });

  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: error.message });
  }
}
