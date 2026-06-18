// Use got-scraping to bypass Cloudflare's TLS fingerprint check
let gotScraping;
try {
  gotScraping = require('got-scraping');
} catch (e) {
  // Fallback - but got-scraping should be installed
  console.error('got-scraping not installed. Run: npm install got-scraping');
}

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
      error: 'accessToken required' 
    });
  }

  try {
    console.log('[Zedox] Generating Stripe checkout...');

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

    // Try with got-scraping first (bypasses Cloudflare via TLS fingerprinting)
    if (gotScraping) {
      try {
        console.log('[Zedox] Trying got-scraping...');
        const response = await gotScraping.gotScraping({
          url: 'https://chatgpt.com/backend-api/payments/checkout',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Origin': 'https://chatgpt.com',
            'Referer': 'https://chatgpt.com/',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
          },
          responseType: 'json',
          body: JSON.stringify(payload),
          // got-scraping automatically impersonates Chrome's TLS fingerprint
          timeout: {
            request: 20000
          }
        });
        
        console.log('[Zedox] got-scraping status:', response.statusCode);
        
        if (response.statusCode === 200) {
          const data = response.body;
          checkoutUrl = data.url || data.stripe_hosted_url || data.checkout_url || '';
          console.log('[Zedox] got-scraping URL:', checkoutUrl);
        }
      } catch (gsError) {
        console.error('[Zedox] got-scraping failed:', gsError.message);
      }
    }

    // Fallback: try standard fetch (will likely fail but worth trying)
    if (!checkoutUrl) {
      console.log('[Zedox] Trying standard fetch endpoints...');
      const endpoints = [
        'https://chatgpt.com/backend-api/payments/checkout',
        'https://chat.openai.com/backend-api/payments/checkout'
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Origin': endpoint.includes('chatgpt.com') ? 'https://chatgpt.com' : 'https://chat.openai.com',
              'Referer': endpoint.includes('chatgpt.com') ? 'https://chatgpt.com/' : 'https://chat.openai.com/'
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const data = await response.json();
            checkoutUrl = data.url || data.stripe_hosted_url || data.checkout_url || '';
            if (checkoutUrl) break;
          }
        } catch (e) {
          console.log(`[Zedox] ${endpoint} error:`, e.message);
        }
      }
    }

    if (!checkoutUrl) {
      return res.status(200).json({
        success: true,
        useClientSide: true,
        checkoutPayload: payload,
        checkoutEndpoint: 'https://chatgpt.com/backend-api/payments/checkout',
        message: 'Server-side blocked. Use browser console method below.'
      });
    }

    const checkoutId = 'ZEDX-' + Date.now().toString(36).toUpperCase();

    return res.status(200).json({
      success: true,
      checkoutId,
      url: checkoutUrl,
      checkoutUrl,
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
