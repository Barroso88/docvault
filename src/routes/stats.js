const express = require('express');
const db = require('../config/db');
const auth = require('../middleware/auth');
const { resolveVaultForRequest } = require('../utils/vaults');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const vault = resolveVaultForRequest(req.user.id, req.query.vaultId || null);
  const total = db.prepare('SELECT COUNT(*) as count FROM documents WHERE vault_id = ?').get(vault.id).count;
  const favs = db.prepare('SELECT COUNT(*) as count FROM documents WHERE vault_id = ? AND favorite = 1').get(vault.id).count;
  const cats = db.prepare('SELECT COUNT(DISTINCT category) as count FROM documents WHERE vault_id = ?').get(vault.id).count;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonth = db
    .prepare('SELECT COUNT(*) as count FROM documents WHERE vault_id = ? AND upload_date >= ?')
    .get(vault.id, monthStart).count;

  const byCategory = db
    .prepare('SELECT category, COUNT(*) as count FROM documents WHERE vault_id = ? GROUP BY category')
    .all(vault.id);

  res.json({ total, favs, cats, thisMonth, byCategory, vaultId: vault.id });
});

module.exports = router;
