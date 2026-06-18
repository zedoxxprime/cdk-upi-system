export default async function handler(req, res) {
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
      error: 'ChatGPT accessToken required. Get from chatgpt.com/api/auth/session'
    });
  }

  try {
    // Call ChatGPT's REAL backend to trigger UPI checkout
    const checkoutRes = await fetch('https://chat.openai.com/backend-api/payments/checkout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://chat.openai.com',
        'Referer': 'https://chat.openai.com/'
      },
      body: JSON.stringify({})
    });

    let data;
    if (checkoutRes.ok) {
      data = await checkoutRes.json();
    } else {
      // Try alternative domain
      const res2 = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
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
      if (!res2.ok) {
        return res.status(400).json({
          success: false,
          error: 'ChatGPT rejected the token. Session expired? Get fresh from chatgpt.com/api/auth/session'
        });
      }
      data = await res2.json();
    }

    const checkoutUrl = data.url || data.checkout_url || data.redirect_url || '';
    const checkoutId = 'CHK-' + Date.now().toString(36).toUpperCase();

    return res.status(200).json({
      success: true,
      checkoutId,
      checkoutUrl: checkoutUrl || 'https://chatgpt.com/payments/checkout',
      raw: data,
      message: '✅ UPI checkout ready!'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Server error: ' + error.message
    });
  }
}
