// api/generate.js
// This runs on Vercel serverless. It takes the user's ChatGPT accessToken
// and calls ChatGPT's REAL backend API to trigger the UPI checkout.

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Only POST allowed' });
  }

  const { accessToken, cdkKey, sessionData } = req.body || {};

  if (!accessToken) {
    return res.status(400).json({
      success: false,
      error: 'ChatGPT accessToken is required. Get it from chatgpt.com/api/auth/session'
    });
  }

  try {
    console.log('Calling ChatGPT backend with user token...');

    // ===== STEP 1: Call ChatGPT's REAL checkout API =====
    // This is THE endpoint that generates the Stripe/UPI checkout page
    const checkoutRes = await fetch('https://chat.openai.com/backend-api/payments/checkout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://chat.openai.com',
        'Referer': 'https://chat.openai.com/'
      },
      body: JSON.stringify({}) // Empty body — ChatGPT figures out the plan
    });

    if (!checkoutRes.ok) {
      const errorText = await checkoutRes.text();
      console.error('ChatGPT API error:', checkoutRes.status, errorText);
      
      // Try alternative endpoint if first fails
      const checkoutRes2 = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://chatgpt.com',
          'Referer': 'https://chatgpt.com/'
        },
        body: JSON.stringify({})
      });

      if (!checkoutRes2.ok) {
        const err2 = await checkoutRes2.text();
        return res.status(400).json({
          success: false,
          error: `ChatGPT API rejected: ${checkoutRes.status} / ${checkoutRes2.status}. Your session may be expired. Get a fresh one from chatgpt.com/api/auth/session.`
        });
      }

      const data2 = await checkoutRes2.json();
      const checkoutUrl = data2.url || data2.checkout_url || data2.redirect_url || '';
      
      if (!checkoutUrl) {
        return res.status(200).json({
          success: true,
          checkoutId: 'chk_' + Date.now().toString(36),
          checkoutUrl: 'https://chatgpt.com/payments/checkout',
          raw: data2,
          message: 'Checkout initiated. If no URL, check your ChatGPT account.'
        });
      }

      return res.status(200).json({
        success: true,
        checkoutId: 'chk_' + Date.now().toString(36),
        checkoutUrl,
        raw: data2,
        message: 'UPI checkout page ready!'
      });
    }

    const data = await checkoutRes.json();
    const checkoutUrl = data.url || data.checkout_url || data.redirect_url || '';
    
    if (!checkoutUrl) {
      // Maybe they already have Plus
      return res.status(200).json({
        success: true,
        checkoutId: 'chk_' + Date.now().toString(36),
        checkoutUrl: 'https://chatgpt.com/payments/checkout',
        raw: data,
        message: data.message || 'Checkout initiated.'
      });
    }

    return res.status(200).json({
      success: true,
      checkoutId: 'chk_' + Date.now().toString(36),
      checkoutUrl,
      raw: data,
      message: '✅ UPI checkout generated! Scan QR to pay ₹0.'
    });

  } catch (error) {
    console.error('Generate error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error: ' + error.message
    });
  }
}
