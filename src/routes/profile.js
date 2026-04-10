const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.user.id);
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

  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

module.exports = router;
