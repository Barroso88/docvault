const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const { FILES_DIR } = require('../config/paths');
const { parseTags, toDocument } = require('../utils/tags');
const {
  logVaultAction,
  getCategoryByKey,
  requireVaultAccess,
  requireVaultPermission,
  resolveVaultForRequest
} = require('../utils/vaults');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

function resolveDocumentCategory(vaultId, requestedCategory, fallbackCategory = 'outros') {
  const categoryKey = String(requestedCategory || fallbackCategory || 'outros').trim() || 'outros';
  return getCategoryByKey(vaultId, categoryKey)?.key
    || getCategoryByKey(vaultId, fallbackCategory)?.key
    || getCategoryByKey(vaultId, 'outros')?.key
    || categoryKey;
}

router.get('/', auth, (req, res) => {
  const vault = resolveVaultForRequest(req.user.id, req.query.vaultId || null);
  const docs = db
    .prepare('SELECT * FROM documents WHERE vault_id = ? ORDER BY upload_date DESC')
    .all(vault.id)
    .map(toDocument);

  res.json(docs);
});

router.post('/', auth, upload.single('file'), (req, res) => {
  const { name, category, date, description } = req.body;
  const vault = resolveVaultForRequest(req.user.id, req.body.vaultId || req.query.vaultId || null);
  requireVaultPermission(req.user.id, vault.id, 'upload');
  const id = uuidv4();
  const file = req.file;
  const categoryKey = resolveDocumentCategory(vault.id, category, 'outros');

  db.prepare(`
    INSERT INTO documents (
      id, user_id, vault_id, name, category, date, description, tags, file_name, file_size, file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.user.id,
    vault.id,
    name || '',
    categoryKey,
    date || null,
    description || null,
    parseTags(req.body.tags),
    file?.originalname || null,
    file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : null,
    file?.filename || null
  );

  const doc = toDocument(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
  logVaultAction({
    vaultId: vault.id,
    actorUserId: req.user.id,
    action: 'document.created',
    documentId: doc.id,
    details: {
      name: doc.name,
      category: doc.category
    }
  });
  res.status(201).json(doc);
});

router.put('/:id', auth, upload.single('file'), (req, res) => {
  const { name, category, date, description } = req.body;
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

  if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });
  const sourceVaultId = doc.vault_id;
  const targetVaultId = req.body.vaultId || sourceVaultId;
  if (sourceVaultId) {
    try {
      requireVaultPermission(req.user.id, sourceVaultId, 'edit');
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message || 'Não tens acesso a este documento' });
    }
  } else if (doc.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Não tens acesso a este documento' });
  }

  if (targetVaultId && targetVaultId !== sourceVaultId) {
    try {
      requireVaultPermission(req.user.id, targetVaultId, 'upload');
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message || 'Não tens permissão para mover para este cofre' });
    }
  }

  let fileName = doc.file_name;
  let fileSize = doc.file_size;
  let filePath = doc.file_path;
  const categoryKey = resolveDocumentCategory(targetVaultId || sourceVaultId, category ?? doc.category, doc.category);

  if (req.file) {
    fileName = req.file.originalname;
    fileSize = `${(req.file.size / 1024 / 1024).toFixed(2)} MB`;
    filePath = req.file.filename;
  }

  const favoriteValue = req.body.favorite;
  const favorite =
    favoriteValue === undefined || favoriteValue === null || favoriteValue === ''
      ? doc.favorite
      : ['1', 'true', 'yes', 'on'].includes(String(favoriteValue).toLowerCase())
        ? 1
        : 0;

  db.prepare(`
    UPDATE documents
    SET name=?, category=?, date=?, description=?, tags=?, file_name=?, file_size=?, file_path=?, favorite=?, vault_id=COALESCE(?, vault_id)
    WHERE id=?
  `).run(
    name || doc.name,
    categoryKey,
    date || doc.date,
    description || doc.description,
    parseTags(req.body.tags ?? doc.tags),
    fileName,
    fileSize,
    filePath,
    favorite,
    targetVaultId && targetVaultId !== sourceVaultId ? targetVaultId : null,
    req.params.id
  );

  const updated = toDocument(
    db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id)
  );
  const actionDetails = {
    name: updated.name,
    category: updated.category,
    favorite: updated.favorite,
    movedToVaultId: targetVaultId !== sourceVaultId ? targetVaultId : null
  };
  logVaultAction({
    vaultId: updated.vault_id || sourceVaultId,
    actorUserId: req.user.id,
    action: targetVaultId !== sourceVaultId ? 'document.moved' : 'document.updated',
    documentId: updated.id,
    details: actionDetails
  });
  res.json(updated);
});

router.delete('/:id', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

  if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });
  if (doc.vault_id) {
    try {
      requireVaultPermission(req.user.id, doc.vault_id, 'delete');
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message || 'Não tens acesso a este documento' });
    }
  } else if (doc.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Não tens acesso a este documento' });
  }

  if (doc.file_path) {
    const filePath = path.join(FILES_DIR, path.basename(doc.file_path));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  if (doc.vault_id) {
    logVaultAction({
      vaultId: doc.vault_id,
      actorUserId: req.user.id,
      action: 'document.deleted',
      documentId: doc.id,
      details: {
        name: doc.name,
        category: doc.category
      }
    });
  }
  res.json({ success: true });
});

router.get('/:id/download', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

  if (!doc || !doc.file_path) return res.status(404).json({ error: 'Ficheiro não encontrado' });
  if (doc.vault_id) {
    try {
      requireVaultAccess(req.user.id, doc.vault_id);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message || 'Não tens acesso a este documento' });
    }
  } else if (doc.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Não tens acesso a este documento' });
  }

  const filePath = path.join(FILES_DIR, path.basename(doc.file_path));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Ficheiro não encontrado' });

  res.download(filePath, doc.file_name || path.basename(filePath));
});

module.exports = router;
