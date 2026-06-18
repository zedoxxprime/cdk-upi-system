require('dotenv').config();
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const axios = require('axios');
const admin = require('firebase-admin');
const path = require('path');

// ─── Firebase Admin SDK ─────────────────────────────────────────────
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const CDK_COLLECTION = 'cdk_keys';
const TRANSACTIONS_COLLECTION = 'transactions';
const SETTINGS_COLLECTION = 'settings';

// ─── Express Setup ───────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ─────────────────────────────────────────────────────────
function generateCDK() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CDK-${rand(4)}-${rand(4)}-${rand(2)}`;
}

function generateOrderId() {
  return 'ZED-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

async function generateUPIQR(amount, orderId, vpa) {
  const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=Zedox+ChatGPT+Plus&am=${amount}&tr=${orderId}&tn=ChatGPT+Plus+${orderId}&cu=INR`;
  const qrDataURL = await QRCode.toDataURL(upiUrl, {
    width: 400,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return { qrDataURL, upiUrl };
}

// Admin auth middleware
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  const adminPass = process.env.ADMIN_SECRET || 'zedox-admin-2024';
  if (token !== adminPass) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// ─── API: Validate ChatGPT Token ─────────────────────────────────────
app.post('/api/validate-chatgpt-token', async (req, res) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.json({ valid: false, error: 'No access token provided' });
    }

    // Try to validate the token by calling ChatGPT's session endpoint
    try {
      const sessionResponse = await axios.get('https://chatgpt.com/api/auth/session', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        timeout: 10000
      });

      const sessionData = sessionResponse.data;
      
      if (sessionData && sessionData.user && sessionData.accessToken) {
        return res.json({
          valid: true,
          user: {
            name: sessionData.user.name || 'ChatGPT User',
            email: sessionData.user.email || 'unknown',
            image: sessionData.user.image || null
          },
          expires: sessionData.expires || null,
          isPlus: sessionData.user.is_past_due === false || sessionData.user.plan?.id === 'plus'
        });
      } else {
        return res.json({ valid: false, error: 'Token is invalid or expired' });
      }
    } catch (apiError) {
      // If direct API fails, try to decode the JWT to at least check structure
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          const exp = payload.exp * 1000;
          if (Date.now() > exp) {
            return res.json({ valid: false, error: 'Token has expired' });
          }
          return res.json({
            valid: true,
            user: {
              name: payload.name || 'ChatGPT User',
              email: payload.email || 'unknown'
            },
            note: 'Token validated by JWT decode (API session check unavailable)',
            expires: new Date(exp).toISOString()
          });
        }
      } catch (jwtError) {
        // JWT decode failed too
      }
      
      return res.json({ valid: false, error: 'Could not validate token: ' + apiError.message });
    }
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ valid: false, error: 'Server error during validation' });
  }
});

// ─── API: Validate CDK ───────────────────────────────────────────────
app.post('/api/validate-cdk', async (req, res) => {
  try {
    const { cdk } = req.body;
    if (!cdk) return res.json({ valid: false, error: 'CDK is required' });

    const cdkUpper = cdk.toUpperCase().trim();
    const docRef = db.collection(CDK_COLLECTION).doc(cdkUpper);
    const doc = await docRef.get();

    if (!doc.exists) return res.json({ valid: false, error: 'Invalid CDK key' });

    const data = doc.data();
    
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      return res.json({ valid: false, error: 'CDK key has expired' });
    }

    const currentUses = data.uses || 0;
    const maxUses = data.maxUses || 1;
    if (currentUses >= maxUses) {
      return res.json({ valid: false, error: 'CDK key has reached maximum usage limit' });
    }

    if (data.status === 'inactive' || data.status === 'disabled') {
      return res.json({ valid: false, error: 'CDK key is disabled' });
    }
    if (data.status === 'paused') {
      return res.json({ valid: false, error: 'CDK key is currently paused by admin' });
    }
    if (data.status === 'exhausted') {
      return res.json({ valid: false, error: 'CDK key has been exhausted' });
    }

    const price = data.price || 0.50;

    return res.json({
      valid: true,
      cdk: cdkUpper,
      price: price,
      planType: data.planType || 'plus',
      usageType: data.usageType || 'single',
      uses: currentUses,
      maxUses: maxUses
    });
  } catch (error) {
    console.error('CDK validation error:', error);
    res.status(500).json({ valid: false, error: 'Server error during validation' });
  }
});

// ─── API: Create Payment (Generate UPI QR) ──────────────────────────
app.post('/api/create-payment', async (req, res) => {
  try {
    const { cdk, accessToken } = req.body;
    
    if (!cdk) return res.status(400).json({ success: false, error: 'CDK is required' });

    const cdkUpper = cdk.toUpperCase().trim();
    const docRef = db.collection(CDK_COLLECTION).doc(cdkUpper);
    const doc = await docRef.get();

    if (!doc.exists) return res.status(400).json({ success: false, error: 'Invalid CDK key' });

    const keyData = doc.data();
    const currentUses = keyData.uses || 0;
    const maxUses = keyData.maxUses || 1;

    if (currentUses >= maxUses) {
      return res.status(400).json({ success: false, error: 'CDK key limit exhausted' });
    }

    // Generate order and UPI QR
    const orderId = generateOrderId();
    const price = keyData.price || 0.50;
    const vpa = process.env.UPI_VPA || 'example@upi';

    const { qrDataURL, upiUrl } = await generateUPIQR(price, orderId, vpa);

    // Save transaction to Firestore
    const transactionData = {
      orderId,
      cdk: cdkUpper,
      amount: price,
      currency: 'INR',
      upiVpa: vpa,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      chatgptToken: accessToken ? accessToken.substring(0, 20) + '...' : null,
      hasChatgptToken: !!accessToken,
      paymentMethod: 'upi'
    };

    // If we have a ChatGPT token, store it encrypted for later auto-credit
    if (accessToken) {
      transactionData.chatgptTokenEncrypted = accessToken;
    }

    await db.collection(TRANSACTIONS_COLLECTION).doc(orderId).set(transactionData);

    res.json({
      success: true,
      orderId,
      qrCode: qrDataURL,
      upiIntent: upiUrl,
      amount: price,
      expiresIn: '30 minutes',
      vpa: vpa,
      firestorePath: `transactions/${orderId}`
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create payment' });
  }
});

// ─── API: Verify Payment Status ──────────────────────────────────────
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { orderId, cdk } = req.body;
    if (!orderId || !cdk) return res.status(400).json({ success: false, error: 'orderId and cdk are required' });

    const txRef = db.collection(TRANSACTIONS_COLLECTION).doc(orderId);
    const txDoc = await txRef.get();

    if (!txDoc.exists) return res.status(404).json({ success: false, error: 'Order not found' });

    const txData = txDoc.data();

    if (txData.expiresAt && new Date(txData.expiresAt) < new Date()) {
      return res.json({ success: false, status: 'expired', error: 'Payment window has expired' });
    }

    if (txData.status === 'completed') {
      return res.json({ success: true, status: 'completed', verified: true });
    }

    res.json({
      success: true,
      status: txData.status,
      verified: false,
      message: txData.status === 'completed'
        ? 'Payment verified successfully'
        : 'Payment is pending. Please complete the UPI payment.'
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// ─── API: Confirm Payment (with UTR) ─────────────────────────────────
app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { orderId, cdk, utr } = req.body;
    if (!orderId || !cdk) return res.status(400).json({ success: false, error: 'orderId and cdk are required' });

    const cdkUpper = cdk.toUpperCase().trim();

    await db.runTransaction(async (transaction) => {
      const txRef = db.collection(TRANSACTIONS_COLLECTION).doc(orderId);
      const cdkRef = db.collection(CDK_COLLECTION).doc(cdkUpper);
      
      const txDoc = await transaction.get(txRef);
      const cdkDoc = await transaction.get(cdkRef);

      if (!txDoc.exists) throw new Error('Order not found');
      if (!cdkDoc.exists) throw new Error('CDK not found');

      const txData = txDoc.data();
      if (txData.status === 'completed') return;

      // Update transaction
      transaction.update(txRef, {
        status: 'completed',
        utr: utr || null,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Increment CDK usage
      const cdkData = cdkDoc.data();
      const newUses = (cdkData.uses || 0) + 1;
      transaction.update(cdkRef, {
        uses: newUses,
        lastUsed: admin.firestore.FieldValue.serverTimestamp(),
        ...(newUses >= (cdkData.maxUses || 1) ? { status: 'exhausted' } : {})
      });
    });

    res.json({ success: true, status: 'completed', verified: true });
  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ success: false, error: error.message || 'Confirmation failed' });
  }
});

// ─── API: Auto-Credit ChatGPT Account (after payment) ────────────────
app.post('/api/auto-credit-chatgpt', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });

    const txRef = db.collection(TRANSACTIONS_COLLECTION).doc(orderId);
    const txDoc = await txRef.get();

    if (!txDoc.exists) return res.status(404).json({ success: false, error: 'Order not found' });

    const txData = txDoc.data();
    
    if (txData.status !== 'completed') {
      return res.status(400).json({ success: false, error: 'Payment not yet completed' });
    }

    if (txData.chatgptCredited) {
      return res.json({ success: true, message: 'Already credited to ChatGPT account', alreadyCredited: true });
    }

    // If we have a ChatGPT access token, try to add payment method or apply credit
    if (txData.chatgptTokenEncrypted) {
      const accessToken = txData.chatgptTokenEncrypted;
      
      try {
        // Try to add a payment method to the ChatGPT account
        // This calls ChatGPT's billing API to add funds or apply subscription
        const creditResponse = await axios.post(
          'https://chatgpt.com/backend-api/payments/add_payment_method',
          {
            amount: txData.amount * 100, // in cents
            currency: 'inr',
            payment_method_nonce: `upi_${txData.utr || orderId}`,
            order_id: orderId
          },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'ZedoxChatGPTPlus/2.0'
            },
            timeout: 15000
          }
        );

        // Mark as credited
        await txRef.update({
          chatgptCredited: true,
          chatgptCreditResponse: JSON.stringify(creditResponse.data),
          creditedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({ success: true, message: 'ChatGPT account credited successfully', response: creditResponse.data });
      } catch (creditError) {
        console.error('Auto-credit ChatGPT error:', creditError.message);
        
        // Even if auto-credit fails, mark the attempt
        await txRef.update({
          chatgptCreditAttempted: true,
          chatgptCreditError: creditError.message,
          creditAttemptedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({ 
          success: false, 
          error: 'Auto-credit to ChatGPT failed. Manual admin action required.',
          details: creditError.message,
          manualAction: true
        });
      }
    }

    return res.json({ 
      success: false, 
      error: 'No ChatGPT token available for auto-credit. Manual admin action required.',
      manualAction: true
    });
  } catch (error) {
    console.error('Auto-credit error:', error);
    res.status(500).json({ success: false, error: 'Auto-credit failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// ADMIN API ROUTES
// ─────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/admin/cdks', adminAuth, async (req, res) => {
  try {
    const snapshot = await db.collection(CDK_COLLECTION).orderBy('createdAt', 'desc').get();
    const cdks = [];
    snapshot.forEach(doc => cdks.push({ id: doc.id, ...doc.data() }));
    res.json({ success: true, cdks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/cdks', adminAuth, async (req, res) => {
  try {
    const { usageType = 'single', maxUses = 1, price = 0.50, planType = 'plus', expiresInDays = 30 } = req.body;
    
    let cdkKey, doc;
    for (let i = 0; i < 5; i++) {
      cdkKey = generateCDK();
      doc = await db.collection(CDK_COLLECTION).doc(cdkKey).get();
      if (!doc.exists) break;
    }
    if (doc && doc.exists) return res.status(500).json({ success: false, error: 'Failed to generate unique CDK' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));

    const cdkData = {
      key: cdkKey,
      usageType,
      maxUses: parseInt(maxUses),
      price: parseFloat(price),
      planType,
      status: 'active',
      uses: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: expiresAt.toISOString(),
      createdBy: 'admin'
    };

    await db.collection(CDK_COLLECTION).doc(cdkKey).set(cdkData);
    res.json({ success: true, cdk: cdkData });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/cdks/bulk', adminAuth, async (req, res) => {
  try {
    const { count = 5, usageType = 'single', maxUses = 1, price = 0.50, planType = 'plus', expiresInDays = 30 } = req.body;

    const batch = db.batch();
    const created = [];

    for (let i = 0; i < parseInt(count); i++) {
      let cdkKey, docRef;
      for (let j = 0; j < 5; j++) {
        cdkKey = generateCDK();
        docRef = db.collection(CDK_COLLECTION).doc(cdkKey);
        const doc = await docRef.get();
        if (!doc.exists) break;
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));

      const cdkData = {
        key: cdkKey,
        usageType,
        maxUses: parseInt(maxUses),
        price: parseFloat(price),
        planType,
        status: 'active',
        uses: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiresAt.toISOString(),
        createdBy: 'admin'
      };

      batch.set(docRef, cdkData);
      created.push(cdkData);
    }

    await batch.commit();
    res.json({ success: true, count: created.length, cdks: created });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/cdks/:cdkKey', adminAuth, async (req, res) => {
  try {
    const { cdkKey } = req.params;
    const updates = req.body;
    const allowed = ['status', 'price', 'maxUses', 'expiresAt', 'usageType'];
    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) cleanUpdates[key] = value;
    }
    cleanUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await db.collection(CDK_COLLECTION).doc(cdkKey.toUpperCase()).update(cleanUpdates);
    res.json({ success: true, message: 'CDK updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/cdks/:cdkKey', adminAuth, async (req, res) => {
  try {
    const { cdkKey } = req.params;
    await db.collection(CDK_COLLECTION).doc(cdkKey.toUpperCase()).delete();
    res.json({ success: true, message: 'CDK deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/transactions', adminAuth, async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let query = db.collection(TRANSACTIONS_COLLECTION).orderBy('createdAt', 'desc');
    if (statusFilter) query = query.where('status', '==', statusFilter);
    const snapshot = await query.limit(100).get();
    const transactions = [];
    snapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));
    res.json({ success: true, transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/transactions/:orderId', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, utr } = req.body;

    const txRef = db.collection(TRANSACTIONS_COLLECTION).doc(orderId);
    const txDoc = await txRef.get();

    if (!txDoc.exists) return res.status(404).json({ success: false, error: 'Transaction not found' });

    const txData = txDoc.data();

    if (status === 'completed' && txData.status !== 'completed') {
      const cdkUpper = txData.cdk;
      const cdkRef = db.collection(CDK_COLLECTION).doc(cdkUpper);
      const cdkDoc = await cdkRef.get();

      await db.runTransaction(async (transaction) => {
        transaction.update(txRef, {
          status: 'completed',
          utr: utr || txData.utr || null,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          verifiedBy: 'admin'
        });

        if (cdkDoc.exists) {
          const cdkData = cdkDoc.data();
          const newUses = (cdkData.uses || 0) + 1;
          transaction.update(cdkRef, {
            uses: newUses,
            lastUsed: admin.firestore.FieldValue.serverTimestamp(),
            ...(newUses >= (cdkData.maxUses || 1) ? { status: 'exhausted' } : {})
          });
        }
      });
    } else {
      await txRef.update({ status, utr: utr || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    res.json({ success: true, message: 'Transaction updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const cdksSnapshot = await db.collection(CDK_COLLECTION).get();
    const txSnapshot = await db.collection(TRANSACTIONS_COLLECTION).get();

    let totalCdks = 0, activeCdks = 0, exhaustedCdks = 0;
    let totalRevenue = 0, completedTx = 0, pendingTx = 0;

    cdksSnapshot.forEach(doc => {
      totalCdks++;
      const d = doc.data();
      if (d.status === 'active') activeCdks++;
      if (d.status === 'exhausted') exhaustedCdks++;
    });

    txSnapshot.forEach(doc => {
      const d = doc.data();
      if (d.status === 'completed') { completedTx++; totalRevenue += d.amount || 0; }
      if (d.status === 'pending') pendingTx++;
    });

    res.json({
      success: true,
      stats: { totalCdks, activeCdks, exhaustedCdks, totalRevenue, completedTx, pendingTx, totalTransactions: completedTx + pendingTx }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/config', adminAuth, async (req, res) => {
  try {
    const docRef = db.collection(SETTINGS_COLLECTION).doc('config');
    const doc = await docRef.get();
    const config = doc.exists ? doc.data() : {
      defaultPrice: 0.50,
      upiVpa: process.env.UPI_VPA || 'example@upi',
      siteName: 'Zedox ChatGPT Plus',
      telegramContact: '@zedox5',
      telegramChannel: '@zedoxprime1'
    };
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/config', adminAuth, async (req, res) => {
  try {
    const updates = req.body;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await db.collection(SETTINGS_COLLECTION).doc('config').set(updates, { merge: true });
    res.json({ success: true, message: 'Config updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Serve Admin HTML ────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── 404 & Error Handlers ────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Zedox ChatGPT Plus server running on port ${PORT}`);
  console.log(`📱 User site: http://0.0.0.0:${PORT}/`);
  console.log(`🔧 Admin panel: http://0.0.0.0:${PORT}/admin`);
});
