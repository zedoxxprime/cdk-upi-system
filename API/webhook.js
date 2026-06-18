const crypto = require('crypto');
const admin = require('firebase-admin');

// ===== HARDCODED VALUES =====
const RAZORPAY_WEBHOOK_SECRET = 'whsec_XXXXXXXXXXXXXXXXXXXXXXXX';
const FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n';
const FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk-xxx@globexo-d9ade.iam.gserviceaccount.com';
const FIREBASE_PROJECT_ID = 'globexo-d9ade';
// ============================

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
    });
}
const db = admin.firestore();

module.exports = async (req, res) => {
    // Set CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);

        const expected = crypto
            .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
            .update(body)
            .digest('hex');

        if (expected !== signature) {
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const event = req.body;

        if (event.event === 'payment_link.paid') {
            const paymentLink = event.payload.payment_link.entity;
            const payment = event.payload.payment.entity;
            const { cdk, sessionToken, userEmail } = paymentLink.notes;

            // Update order
            const orderSnap = await db.collection('orders')
                .where('paymentId', '==', paymentLink.id)
                .limit(1)
                .get();

            if (!orderSnap.empty) {
                await orderSnap.docs[0].ref.update({
                    status: 'completed',
                    paidAt: admin.firestore.FieldValue.serverTimestamp(),
                    razorpayPaymentId: payment.id,
                });
            }

            // Activate ChatGPT Plus
            try {
                await fetch('https://chatgpt.com/backend-api/plus/activate', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${sessionToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        plan: 'plus',
                        trial: true,
                        source: 'upi_qr',
                        paymentId: payment.id,
                    }),
                });
                console.log(`✅ ChatGPT Plus activated for ${userEmail}`);
            } catch (e) {
                console.error('Activation error:', e);
            }
        }

        return res.json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: error.message });
    }
};
