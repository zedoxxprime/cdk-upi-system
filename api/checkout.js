export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }
  
  const { accessToken } = req.body;
  
  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' });
  }
  
  try {
    const response = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'oai-language': 'en-IN',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        plan_name: 'chatgptplusplan',
        billing_details: {
          country: 'IN',
          currency: 'INR'
        },
        promo_campaign: 'plus-1-month-free',
        checkout_ui_mode: 'redirect'
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'ChatGPT API error',
        details: data,
        status: response.status
      });
    }
    
    return res.status(200).json(data);
    
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
}
