export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Only POST' });
  }

  const { accessToken, cdkKey, sessionData } = req.body || {};

  if (!accessToken) {
    return res.status(400).json({ 
      success: false, 
      error: 'accessToken required. Get from: https://chatgpt.com/api/auth/session' 
    });
  }

  try {
    console.log('[Zedox] Processing checkout request...');

    const payload = {
      plan_name: 'chatgptplusplan',
      billing_details: {
        country: 'IN',
        currency: 'INR'
      },
      cancel_url: 'https://chatgpt.com/',
      promo_campaign: {
        promo_campaign_id: 'plus-1-month-free',
        is_coupon_from_query_param: false
      },
      checkout_ui_mode: 'hosted'
    };

    let checkoutUrl = '';
    let errorDetail = '';

    const endpoints = [
      { url: 'https://chatgpt.com/backend-api/payments/checkout', origin: 'https://chatgpt.com' },
      { url: 'https://chat.openai.com/backend-api/payments/checkout', origin: 'https://chat.openai.com' }
    ];

    for (const ep of endpoints) {
      try {
        const response = await fetch(ep.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Origin': ep.origin,
            'Referer': ep.origin + '/',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const text = await response.text();

        if (response.ok) {
          try {
            const data = JSON.parse(text);
            checkoutUrl = data.url || data.stripe_hosted_url || data.checkout_url || '';
            if (checkoutUrl && checkoutUrl.startsWith('http')) break;
          } catch(e) {}
        } else {
          errorDetail = text;
          console.log(`[Zedox] ${ep.url} failed (${response.status}): ${text.substring(0, 200)}`);
        }
      } catch(e) {
        console.log(`[Zedox] ${ep.url} error:`, e.message);
      }
    }

    // Server-side blocked - return payload for client-side execution
    if (!checkoutUrl) {
      return res.status(200).json({
        success: true,
        useClientSide: true,
        checkoutPayload: payload,
        checkoutEndpoint: 'https://chatgpt.com/backend-api/payments/checkout',
        message: 'Server-side blocked by Cloudflare. Use client-side fetch.',
        errorDetail: errorDetail
      });
    }

    const checkoutId = 'ZEDX-' + Date.now().toString(36).toUpperCase();

    return res.status(200).json({
      success: true,
      checkoutId: checkoutId,
      url: checkoutUrl,
      checkoutUrl: checkoutUrl,
      stripeUrl: checkoutUrl,
      message: '✅ Stripe UPI checkout generated!'
    });

  } catch (error) {
    console.error('[Zedox] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
