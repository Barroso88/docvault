const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const db = require('../config/db');
const { ensurePersonalVaultForUser } = require('../utils/vaults');

const JWT_SECRET = process.env.JWT_SECRET || 'docvault-secret-change-me-in-production';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const router = express.Router();

function getLinkedGoogleAccount(userId) {
  return db.prepare('SELECT * FROM google_accounts WHERE user_id = ?').get(userId) || null;
}

function createTokenAndUser(user, extra = {}) {
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      ...extra
    }
  };
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Preenche todos os campos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A password deve ter pelo menos 6 caracteres' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.password && existing.password !== '') {
      return res.status(409).json({ error: 'Email já existe' });
    }

    const hashed = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET name = ?, password = ? WHERE id = ?').run(name, hashed, existing.id);
    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(existing.id);
    const personalVault = ensurePersonalVaultForUser(user.id, user.name);
    const linkedGoogle = getLinkedGoogleAccount(user.id);
    return res.status(200).json(createTokenAndUser(user, {
      activeVaultId: personalVault.id,
      provider: linkedGoogle ? 'google' : 'email',
      picture: linkedGoogle?.picture || undefined
    }));
  }

  const hashed = await bcrypt.hash(password, 10);
  const id = uuidv4();

  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)')
    .run(id, name, email, hashed);

  const personalVault = ensurePersonalVaultForUser(id, name);
  res.status(201).json(createTokenAndUser({ id, name, email }, {
    activeVaultId: personalVault.id,
    provider: 'email'
  }));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Preenche todos os campos' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Credenciais erradas' });
  if (!user.password) {
    return res.status(401).json({ error: 'Esta conta usa login com Google' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Credenciais erradas' });

  const personalVault = ensurePersonalVaultForUser(user.id, user.name);
  const linkedGoogle = getLinkedGoogleAccount(user.id);
  res.json(createTokenAndUser(user, {
    activeVaultId: personalVault.id,
    provider: linkedGoogle ? 'google' : 'email',
    picture: linkedGoogle?.picture || undefined
  }));
});

router.post('/google', async (req, res) => {
  if (!googleClient) {
    return res.status(500).json({ error: 'Google login não configurado' });
  }

  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Credencial em falta' });

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
  } catch {
    return res.status(401).json({ error: 'Credencial Google inválida' });
  }

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email || payload.email_verified !== true) {
    return res.status(401).json({ error: 'Conta Google não verificada' });
  }

  const googleSub = payload.sub;
  const email = payload.email;
  const name = payload.name || email.split('@')[0];
  const picture = payload.picture || null;

  const linked = db.prepare('SELECT u.* FROM google_accounts g JOIN users u ON u.id = g.user_id WHERE g.google_sub = ?')
    .get(googleSub);

  if (linked) {
    const personalVault = ensurePersonalVaultForUser(linked.id, linked.name);
    return res.json(createTokenAndUser(linked, { picture, provider: 'google', activeVaultId: personalVault.id }));
  }

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    db.prepare('INSERT OR REPLACE INTO google_accounts (id, user_id, google_sub, email, picture) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), user.id, googleSub, email, picture);
  } else {
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)')
      .run(id, name, email, '');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    db.prepare('INSERT INTO google_accounts (id, user_id, google_sub, email, picture) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), id, googleSub, email, picture);
  }

  const personalVault = ensurePersonalVaultForUser(user.id, user.name);
  const response = createTokenAndUser(user, { picture, provider: 'google', activeVaultId: personalVault.id });
  res.json(response);
});

module.exports = router;
