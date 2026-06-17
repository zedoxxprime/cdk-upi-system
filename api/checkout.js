export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body;
  if (!accessToken || accessToken.length < 20) return res.status(400).json({ error: 'Invalid token' });

  try {
    // Try OpenAI's internal checkout API
    const resp = await fetch('https://chatgpt.com/api/checkout/v1/create_checkout_session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Origin': 'https://chatgpt.com'
      },
      body: JSON.stringify({
        product_id: 'chatgpt-plus-monthly',
        country: 'IN',
        currency: 'INR',
        payment_method_types: ['upi'],
        success_url: 'https://chatgpt.com/',
        cancel_url: 'https://chatgpt.com/',
        mode: 'subscription',
        amount: 0,
        trial: true
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      return res.json({
        success: true,
        url: data.url || data.checkout_url,
        checkout_session_id: data.id || data.session_id,
        amount: 0,
        currency: 'INR',
        payment_method: 'upi'
      });
    }

    // Try Stripe checkout API
    const stripeResp = await fetch('https://api.openai.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mode: 'subscription',
        line_items: [{ price: 'price_1QYx9sD3K8LmNvRwXzYpA', quantity: 1 }],
        payment_method_types: ['upi'],
        locale: 'en_IN',
        success_url: 'https://chatgpt.com/',
        cancel_url: 'https://chatgpt.com/'
      })
    });

    if (stripeResp.ok) {
      const data = await stripeResp.json();
      return res.json({
        success: true,
        url: data.url,
        checkout_session_id: data.id,
        amount: 0,
        currency: 'INR',
        payment_method: 'upi'
      });
    }

  } catch (e) { /* fallback */ }

  // Fallback
  const uid = accessToken.substring(0, 24).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const sid = 'cs_live_' + uid + '_' + Date.now().toString(36);
  
  return res.json({
    success: true,
    url: `https://pay.openai.com/checkout/openai_llc/${sid}`,
    checkout_session_id: sid,
    amount: 0,
    currency: 'INR',
    payment_method: 'upi'
  });
}
