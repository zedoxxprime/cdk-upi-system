const { fetch } = require('node-curl-impersonate');

// Chrome 124 impersonation preset
const PRESET = 'chrome124';

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST' });
  }

  try {
    const { accessToken, plan, promoCampaign, country, currency } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing accessToken' });
    }

    // Build payload matching the working open_stripe.py approach
    const payload = {
      plan_name: plan || 'chatgptplusplan',
      billing_details: {
        country: country || 'IN',
        currency: currency || 'INR'
      },
      cancel_url: 'https://chatgpt.com/',
      checkout_ui_mode: 'hosted'
    };

    // Add promo campaign for free trial
    if (promoCampaign) {
      payload.promo_campaign = {
        promo_campaign_id: promoCampaign,
        is_coupon_from_query_param: false
      };
    }

    console.log('🔵 Sending checkout request...');

    const response = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      body: JSON.stringify(payload),
      timeout: 15000,
      impersonate: PRESET
    });

    const data = await response.json();
    console.log('✅ Response:', JSON.stringify(data).substring(0, 300));

    // Extract the Stripe checkout URL
    const stripeUrl = data.url || data.stripe_hosted_url || data.checkout_url || null;

    if (!stripeUrl) {
      return res.status(500).json({
        error: 'No checkout URL in response',
        raw: data
      });
    }

    return res.status(200).json({
      success: true,
      url: stripeUrl,
      session_id: stripeUrl.split('cs_')[1]?.split('_')[0] || null
    });

  } catch (err) {
    console.error('🔴 Error:', err.message);
    
    // Return error with fallback instructions
    return res.status(500).json({
      error: err.message,
      fallback: true,
      message: 'Server-side generation failed. Use the bookmarklet below instead.'
    });
  }
};
