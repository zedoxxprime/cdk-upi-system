const { db } = require('../firebase-config');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Simple auth check via query param
  const adminKey = req.headers['authorization']?.replace('Bearer ', '') || req.query.key;
  if (adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET' && req.query.action === 'list') {
      const snap = await db.collection('activation_keys').get();
      const keys = [];
      snap.forEach(d => keys.push({ id: d.id, ...d.data() }));
      return res.json({ keys });
    }

    if (req.method === 'POST' && req.query.action === 'create') {
      const { key, plan, label, maxUses } = req.body;
      await db.collection('activation_keys').doc(key).set({
        active: true,
        plan: plan || 'plus',
        label: label || '',
        maxUses: maxUses || 100,
        usesRemaining: maxUses || 100,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ success: true });
    }

    if (req.method === 'PUT' && req.query.action === 'toggle') {
      const { key, active } = req.body;
      await db.collection('activation_keys').doc(key).update({ active });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
