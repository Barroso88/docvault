const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

function getProfileWithGoogle(userId) {
  const user = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.created_at,
      ga.picture,
      CASE WHEN ga.id IS NOT NULL THEN 'google' ELSE 'email' END AS provider
    FROM users u
    LEFT JOIN google_accounts ga ON ga.user_id = u.id
    WHERE u.id = ?
  `).get(userId);

  if (!user) return null;
  return {
    ...user,
    picture: user.picture || null
  };
}

router.get('/', auth, (req, res) => {
  const user = getProfileWithGoogle(req.user.id);
  res.json(user);
});

router.put('/', auth, async (req, res) => {
  const { name, password } = req.body;

  if (name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  }

  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'A password deve ter pelo menos 6 caracteres' });
    }

    const hashed = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
  }

  const user = getProfileWithGoogle(req.user.id);
  res.json(user);
});

module.exports = router;
