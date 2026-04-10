const express = require('express');
const path = require('path');
const { PUBLIC_DIR } = require('../config/paths');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

router.get('/invite/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

router.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

router.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

module.exports = router;
