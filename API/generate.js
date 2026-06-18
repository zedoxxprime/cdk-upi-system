// No Razorpay, no webhooks, no Firebase Admin
// Just calls ChatGPT's internal UPI QR API

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { accessToken, userEmail, userName, cdkKey } = req.body;

        if (!accessToken) {
            return res.status(400).json({ 
                success: false, 
                error: 'accessToken required. Get from chatgpt.com/api/auth/session' 
            });
        }

        console.log('[Zedox] Generating UPI QR for user:', userEmail || 'unknown');

        // ===== CHATGPT'S REAL UPI PAYMENT API =====
        // This is the same endpoint ChatGPT uses when you click "Claim free offer"
        const payload = {
            plan_name: 'chatgptplusplan',
            billing_details: {
                country: 'IN',
                currency: 'INR',
                // Optional: Add address if needed
                address: {
                    line1: 'Mumbai',
                    city: 'Mumbai',
                    state: 'Maharashtra',
                    postal_code: '500025',
                    country: 'IN'
                }
            },
            promo_code: null,
            cancel_url: 'https://chatgpt.com/',
            checkout_ui_mode: 'redirect',
            // This tells ChatGPT to generate a UPI QR
            payment_methods: ['upi'],
            payment_method_options: {
                upi: {
                    // Request QR generation
                    mandate: true
                }
            }
        };

        // Try both possible endpoints
        const endpoints = [
            'https://chatgpt.com/backend-api/payments/checkout',
            'https://chat.openai.com/backend-api/payments/checkout'
        ];

        let checkoutUrl = '';
        let paymentId = '';
        let responseData = null;

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Origin': endpoint.includes('chatgpt.com') ? 'https://chatgpt.com' : 'https://chat.openai.com',
                        'Referer': endpoint.includes('chatgpt.com') ? 'https://chatgpt.com/' : 'https://chat.openai.com/'
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                console.log(`[Zedox] ${endpoint} status:`, response.status);

                if (response.ok && data) {
                    // Look for UPI QR URL or checkout URL
                    checkoutUrl = data.url || data.checkout_url || data.redirect_url || data.stripe_hosted_url || '';
                    paymentId = data.id || data.payment_id || data.checkout_id || '';
                    responseData = data;
                    
                    if (checkoutUrl) {
                        console.log('[Zedox] Got checkout URL:', checkoutUrl);
                        break;
                    }
                }
            } catch (e) {
                console.log(`[Zedox] ${endpoint} failed:`, e.message);
            }
        }

        // If we got a checkout URL, it's likely a Stripe UPI link
        // ChatGPT uses Stripe for UPI payments in India
        if (!checkoutUrl) {
            // Fallback: Construct a UPI link from the response
            // Sometimes ChatGPT returns a QR code directly
            if (responseData?.qr_code) {
                checkoutUrl = responseData.qr_code;
            } else if (responseData?.upi_link) {
                checkoutUrl = responseData.upi_link;
            } else {
                throw new Error('No UPI QR URL received from ChatGPT');
            }
        }

        return res.status(200).json({
            success: true,
            paymentId: paymentId || 'CHK-' + Date.now().toString(36).toUpperCase(),
            url: checkoutUrl,
            checkoutUrl: checkoutUrl,
            message: '✅ ChatGPT UPI QR generated!',
            raw: responseData // Optional: For debugging
        });

    } catch (error) {
        console.error('[Zedox] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate UPI QR'
        });
    }
};
