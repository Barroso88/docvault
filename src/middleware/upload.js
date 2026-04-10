const multer = require('multer');
const path = require('path');
const { FILES_DIR } = require('../config/paths');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILES_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = upload;
