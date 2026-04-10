require('dotenv').config();

const app = require('./app');

const PORT = Number(process.env.PORT || 3015);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`DocVault API online na porta ${PORT}`);
});
