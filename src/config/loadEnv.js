const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT_DIR = path.join(__dirname, '..', '..');
const candidates = [
  path.join(ROOT_DIR, '.env'),
  path.join(process.env.DATA_DIR || '/data', '.env'),
  path.join(ROOT_DIR, 'data', '.env')
];

for (const filePath of candidates) {
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath });
  }
}
