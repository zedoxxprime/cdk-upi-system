const Razorpay = require('razorpay');
const admin = require('firebase-admin');

// ===== HARDCODED KEYS (REPLACE WITH YOURS) =====
const RAZORPAY_KEY_ID = 'rzp_test_XXXXXXXXXXXX';
const RAZORPAY_KEY_SECRET = 'XXXXXXXXXXXXXXXXXXXXXXXX';
const FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n';
const FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk-xxx@globexo-d9ade.iam.gserviceaccount.com';
const FIREBASE_PROJECT_ID = 'globexo-d9ade';
// ==============================================

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: FIREBASE_PROJECT_ID,
                clientEmail: FIREBASE_CLIENT_EMAIL,
                privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
    } catch (e) {
        console.error('Firebase init error:', e);
    }
}
const db = admin.firestore();

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Only POST allowed' });
    }

    try {
        const { cdk, sessionToken, userEmail, userName } = req.body || {};

        // ===== 1. VALIDATE INPUT =====
        if (!cdk) {
            return res.status(400).json({ success: false, error: 'CDK key is required' });
        }
        if (!sessionToken) {
            return res.status(400).json({ success: false, error: 'ChatGPT session token required' });
        }

        // ===== 2. VALIDATE CDK FROM FIREBASE =====
        const cdkSnap = await db.collection('cdk')
            .where('key', '==', cdk)
            .where('used', '==', false)
            .limit(1)
            .get();

        if (cdkSnap.empty) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid or already used CDK key' 
            });
        }

        const cdkDoc = cdkSnap.docs[0];
        const cdkData = cdkDoc.data();
        const maxUses = cdkData.maxUses || 1;
        const currentUses = cdkData.uses || 0;

        if (currentUses >= maxUses) {
            return res.status(400).json({ 
                success: false, 
                error: `CDK usage limit reached (${currentUses}/${maxUses})` 
            });
        }

        // ===== 3. CREATE RAZORPAY PAYMENT LINK (UPI) =====
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
                userEmail: userEmail || 'user@example.com',
            },
            callback_url: `${req.headers.origin || 'https://chatgpt-upi-web.vercel.app'}?success=true&payment_id={payment_id}`,
            callback_method: 'get',
            upi_link: true,
            expire_by: Math.floor(Date.now() / 1000) + 3600,
        });

        // ===== 4. UPDATE CDK USAGE =====
        const newUses = currentUses + 1;
        const updateData = {
            uses: newUses,
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUserEmail: userEmail || 'user@example.com',
        };

        if (newUses >= maxUses) {
            updateData.used = true;
        }

        await cdkDoc.ref.update(updateData);

        // ===== 5. STORE ORDER IN FIREBASE =====
        await db.collection('orders').add({
            paymentId: paymentLink.id,
            cdk: cdk,
            userEmail: userEmail || 'user@example.com',
            sessionToken: sessionToken,
            amount: 0,
            currency: 'INR',
            status: 'pending',
            paymentUrl: paymentLink.short_url,
            qrCodeUrl: paymentLink.qr_code,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 3600000),
        });

        // ===== 6. RETURN SUCCESS =====
        return res.status(200).json({
            success: true,
            paymentId: paymentLink.id,
            paymentUrl: paymentLink.short_url,
            qrCodeUrl: paymentLink.qr_code,
            expiresAt: paymentLink.expire_by,
            message: '✅ UPI QR generated successfully!'
        });

    } catch (error) {
        console.error('[Zedox API] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate QR'
        });
    }
};
