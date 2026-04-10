const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const resolveDataPath = (value, fallback) => {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
};

const DATA_DIR = resolveDataPath(process.env.DATA_DIR, path.join(ROOT_DIR, 'data'));
const PUBLIC_DIR = resolveDataPath(process.env.PUBLIC_DIR, path.join(ROOT_DIR, 'public'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_DIR = path.join(DATA_DIR, 'db');
const DB_PATH = path.join(DB_DIR, 'docvault.db');

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  PUBLIC_DIR,
  FILES_DIR,
  DB_DIR,
  DB_PATH
};
