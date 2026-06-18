const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

// ===== HARDCODED KEYS (Replace with your actual keys) =====
const RAZORPAY_KEY_ID = 'rzp_test_XXXXXXXXXXXX';
const RAZORPAY_KEY_SECRET = 'XXXXXXXXXXXXXXXXXXXXXXXX';
const FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n';
const FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk-xxx@globexo-d9ade.iam.gserviceaccount.com';
const FIREBASE_PROJECT_ID = 'globexo-d9ade';
// ===========================================================

// Initialize Firebase Admin
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

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

module.exports = async (req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        try {
            const { cdk, sessionToken, userEmail, userName } = req.body;

            // Validate CDK from Firebase
            const cdkSnap = await db.collection('cdk')
                .where('key', '==', cdk)
                .where('used', '==', false)
                .limit(1)
                .get();

            if (cdkSnap.empty) {
                return res.status(400).json({ error: 'Invalid or already used CDK' });
            }
            const cdkDoc = cdkSnap.docs[0];

            // Create Razorpay Payment Link (UPI QR)
            const paymentLink = await razorpay.paymentLink.create({
                amount: 0,
                currency: 'INR',
                description: 'ChatGPT Plus - 1 Month Free Trial',
                customer: {
                    email: userEmail || 'user@example.com',
                    name: userName || 'ChatGPT User',
                },
                notify: { email: false, sms: false },
                reminder_enable: false,
                notes: {
                    cdk: cdk,
                    sessionToken: sessionToken,
                    userEmail: userEmail,
                },
                callback_url: `${req.headers.origin}?success=true&payment_id={payment_id}`,
                callback_method: 'get',
                upi_link: true,
                expire_by: Math.floor(Date.now() / 1000) + 3600,
            });

            // Mark CDK as used
            await cdkDoc.ref.update({
                used: true,
                usedAt: admin.firestore.FieldValue.serverTimestamp(),
                userEmail: userEmail,
                paymentLinkId: paymentLink.id,
            });

            // Store order
            await db.collection('orders').add({
                paymentId: paymentLink.id,
                cdk: cdk,
                userEmail: userEmail,
                sessionToken: sessionToken,
                amount: 0,
                currency: 'INR',
                status: 'pending',
                paymentUrl: paymentLink.short_url,
                qrCodeUrl: paymentLink.qr_code,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: new Date(Date.now() + 3600000),
            });

            return res.status(200).json({
                success: true,
                paymentId: paymentLink.id,
                paymentUrl: paymentLink.short_url,
                qrCodeUrl: paymentLink.qr_code,
                expiresAt: paymentLink.expire_by,
            });

        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ error: error.message || 'Failed to generate QR' });
        }
    });
};
