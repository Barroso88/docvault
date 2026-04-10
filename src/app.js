const express = require('express');
const cors = require('cors');
const { PUBLIC_DIR } = require('./config/paths');

const metaRoutes = require('./routes/meta');
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const statsRoutes = require('./routes/stats');
const profileRoutes = require('./routes/profile');
const vaultRoutes = require('./routes/vaults');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

app.use('/', metaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/vaults', vaultRoutes);

module.exports = app;
