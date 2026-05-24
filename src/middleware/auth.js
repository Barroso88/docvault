const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'docvault-secret-change-me-in-production';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}

module.exports = auth;
