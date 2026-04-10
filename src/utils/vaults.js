const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { FILES_DIR } = require('../config/paths');
const { COLOR_OPTIONS, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ORDER, ICON_OPTIONS, slugifyCategoryName } = require('./categoryDefaults');

const ROLE_ORDER = {
  owner: 3,
  editor: 2,
  viewer: 1
};

const ROLE_PERMISSIONS = {
  viewer: [],
  editor: ['view', 'upload', 'edit', 'move'],
  owner: ['view', 'upload', 'edit', 'move', 'delete', 'invite', 'manage', 'audit']
};

const ACTION_PERMISSIONS = {
  view: 'viewer',
  upload: 'editor',
  edit: 'editor',
  move: 'editor',
  delete: 'owner',
  invite: 'owner',
  manage: 'owner',
  audit: 'owner'
};

function normalizeRole(role, fallback = 'viewer') {
  const value = String(role || fallback || 'viewer').toLowerCase();
  return ['owner', 'editor', 'viewer'].includes(value) ? value : fallback;
}

function canRolePerform(role, action) {
  const normalizedRole = normalizeRole(role);
  return (ROLE_PERMISSIONS[normalizedRole] || []).includes(action);
}

function serializeVault(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    owner_user_id: row.owner_user_id,
    created_by: row.created_by,
    is_personal: row.is_personal === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    role: row.role || row.member_role || null,
    member_count: row.member_count || 0
  };
}

function serializeMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    vault_id: row.vault_id,
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    picture: row.picture || null,
    role: row.role,
    created_at: row.created_at
  };
}

function serializeInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    vault_id: row.vault_id,
    vault_name: row.vault_name || null,
    vault_description: row.vault_description || null,
    email: row.email,
    role: row.role,
    token: row.token,
    status: row.status,
    invited_by: row.invited_by,
    invited_by_name: row.invited_by_name || null,
    invited_by_email: row.invited_by_email || null,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    expires_at: row.expires_at
  };
}

function ensurePersonalVaultForUser(userId, userName = '') {
  let vault = db
    .prepare('SELECT * FROM vaults WHERE owner_user_id = ? AND is_personal = 1')
    .get(userId);

  if (vault) return vault;

  const vaultId = uuidv4();
  const name = userName ? `Cofre de ${userName.split(' ')[0]}` : 'Cofre pessoal';
  db.prepare(`
    INSERT INTO vaults (id, name, description, owner_user_id, created_by, is_personal)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(vaultId, name, 'Espaço privado por defeito', userId, userId);

  db.prepare(`
    INSERT OR IGNORE INTO vault_members (id, vault_id, user_id, role)
    VALUES (?, ?, ?, 'owner')
  `).run(uuidv4(), vaultId, userId);

  ensureVaultCategories(vaultId, userId);

  vault = db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId);
  return vault;
}

function ensureVaultCategories(vaultId, createdByUserId = null) {
  const existing = db
    .prepare('SELECT key FROM categories WHERE vault_id = ?')
    .all(vaultId)
    .map((row) => row.key);
  const existingSet = new Set(existing);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO categories (id, vault_id, key, name, icon, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  DEFAULT_CATEGORY_ORDER.forEach((key) => {
    if (existingSet.has(key)) return;
    const category = DEFAULT_CATEGORIES[key];
    insert.run(uuidv4(), vaultId, key, category.name, category.icon, category.color, createdByUserId);
  });
}

function getVaultMembership(userId, vaultId) {
  return db
    .prepare(`
      SELECT v.*, m.role AS member_role
      FROM vaults v
      JOIN vault_members m ON m.vault_id = v.id
      WHERE v.id = ? AND m.user_id = ?
    `)
    .get(vaultId, userId);
}

function requireVaultAccess(userId, vaultId, allowedRoles = null) {
  const access = getVaultMembership(userId, vaultId);
  if (!access) {
    const err = new Error('Não tens acesso a este cofre');
    err.status = 403;
    throw err;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length) {
    const minAllowed = Math.min(...allowedRoles.map((role) => ROLE_ORDER[normalizeRole(role)] || 0));
    const current = ROLE_ORDER[normalizeRole(access.member_role)] || 0;
    if (current < minAllowed) {
      const err = new Error('Permissões insuficientes');
      err.status = 403;
      throw err;
    }
  }

  return serializeVault(access);
}

function requireVaultPermission(userId, vaultId, action) {
  const access = getVaultMembership(userId, vaultId);
  if (!access) {
    const err = new Error('Não tens acesso a este cofre');
    err.status = 403;
    throw err;
  }

  const requiredRole = ACTION_PERMISSIONS[action] || 'viewer';
  const current = ROLE_ORDER[normalizeRole(access.member_role)] || 0;
  const required = ROLE_ORDER[requiredRole] || 0;

  if (current < required) {
    const err = new Error('Permissões insuficientes');
    err.status = 403;
    throw err;
  }

  return {
    vault: serializeVault(access),
    role: normalizeRole(access.member_role)
  };
}

function logVaultAction({ vaultId, actorUserId, action, documentId = null, details = null }) {
  db.prepare(`
    INSERT INTO audit_logs (id, vault_id, document_id, actor_user_id, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    vaultId,
    documentId,
    actorUserId,
    action,
    details ? JSON.stringify(details) : null
  );
}

function listAccessibleVaults(userId) {
  ensurePersonalVaultForUser(userId);

  const vaults = db
    .prepare(`
      SELECT
        v.*,
        m.role AS role,
        (
          SELECT COUNT(*)
          FROM vault_members vm
          WHERE vm.vault_id = v.id
        ) AS member_count
      FROM vaults v
      JOIN vault_members m ON m.vault_id = v.id
      WHERE m.user_id = ?
      ORDER BY v.is_personal DESC, v.name COLLATE NOCASE ASC
    `)
    .all(userId)
    .map(serializeVault);

  return vaults;
}

function createVault({ name, description = '', createdByUser }) {
  const ownerId = createdByUser.id;
  const vaultId = uuidv4();
  const vaultName = (name || '').trim() || 'Novo cofre';

  db.prepare(`
    INSERT INTO vaults (id, name, description, owner_user_id, created_by, is_personal)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(vaultId, vaultName, description || null, ownerId, ownerId);

  db.prepare(`
    INSERT INTO vault_members (id, vault_id, user_id, role)
    VALUES (?, ?, ?, 'owner')
  `).run(uuidv4(), vaultId, ownerId);

  ensureVaultCategories(vaultId, ownerId);

  return db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId);
}

function updateVault(vaultId, patch = {}) {
  const current = db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId);
  if (!current) return null;

  const nextName = patch.name !== undefined ? String(patch.name).trim() : current.name;
  const nextDescription = patch.description !== undefined ? String(patch.description).trim() : current.description;

  db.prepare(`
    UPDATE vaults
    SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextName || current.name, nextDescription || null, vaultId);

  return db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId);
}

function deleteVaultAndContent(vaultId) {
  const vault = db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId);
  if (!vault) return null;

  const docs = db
    .prepare('SELECT id, file_path, file_name FROM documents WHERE vault_id = ?')
    .all(vaultId);

  const removeDocuments = db.prepare('DELETE FROM documents WHERE vault_id = ?');
  const removeVault = db.prepare('DELETE FROM vaults WHERE id = ?');

  const tx = db.transaction((id) => {
    removeDocuments.run(id);
    removeVault.run(id);
  });
  tx(vaultId);

  const deletedFiles = [];
  const failedFiles = [];
  docs.forEach((doc) => {
    if (!doc.file_path) return;
    const filePath = path.join(FILES_DIR, path.basename(doc.file_path));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        deletedFiles.push(doc.file_path);
      } catch {
        failedFiles.push(doc.file_path);
      }
    }
  });

  return {
    vault,
    documentsDeleted: docs.length,
    deletedFiles,
    failedFiles
  };
}

function listVaultAudit(vaultId, limit = 50) {
  return db
    .prepare(`
      SELECT
        a.*,
        u.name AS actor_name,
        u.email AS actor_email,
        ga.picture AS actor_picture
      FROM audit_logs a
      JOIN users u ON u.id = a.actor_user_id
      LEFT JOIN google_accounts ga ON ga.user_id = u.id
      WHERE a.vault_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `)
    .all(vaultId, limit)
    .map((row) => ({
      id: row.id,
      vault_id: row.vault_id,
      document_id: row.document_id,
      actor_user_id: row.actor_user_id,
      actor_name: row.actor_name,
      actor_email: row.actor_email,
      actor_picture: row.actor_picture || null,
      action: row.action,
      details: row.details ? JSON.parse(row.details) : null,
      created_at: row.created_at
    }));
}

function listVaultMembers(vaultId) {
  return db
    .prepare(`
      SELECT
        vm.id,
        vm.vault_id,
        vm.user_id,
        vm.role,
        vm.created_at,
        u.name,
        u.email,
        ga.picture
      FROM vault_members vm
      JOIN users u ON u.id = vm.user_id
      LEFT JOIN google_accounts ga ON ga.user_id = u.id
      WHERE vm.vault_id = ?
      ORDER BY vm.role DESC, u.name COLLATE NOCASE ASC
    `)
    .all(vaultId)
    .map(serializeMember);
}

function listVaultInvites(vaultId) {
  return db
    .prepare(`
      SELECT
        i.*,
        v.name AS vault_name,
        u.name AS invited_by_name
      FROM vault_invites i
      JOIN vaults v ON v.id = i.vault_id
      JOIN users u ON u.id = i.invited_by
      WHERE i.vault_id = ?
      ORDER BY i.created_at DESC
    `)
    .all(vaultId)
    .map(serializeInvite);
}

function createVaultInvite({ vaultId, email, role = 'viewer', invitedByUser }) {
  const token = uuidv4().replace(/-/g, '');
  const inviteId = uuidv4();
  const normalizedRole = normalizeRole(role, 'viewer');
  const inviteEmail = String(email || '').trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();

  db.prepare(`
    INSERT INTO vault_invites (id, vault_id, email, role, token, status, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(inviteId, vaultId, inviteEmail, normalizedRole, token, invitedByUser.id, expiresAt);

  const row = db.prepare(`
    SELECT i.*, v.name AS vault_name, u.name AS invited_by_name
    FROM vault_invites i
    JOIN vaults v ON v.id = i.vault_id
    JOIN users u ON u.id = i.invited_by
    WHERE i.id = ?
  `).get(inviteId);

  return serializeInvite(row);
}

function acceptVaultInvite({ token, user }) {
  const invite = db
    .prepare(`
      SELECT i.*, v.name AS vault_name
      FROM vault_invites i
      JOIN vaults v ON v.id = i.vault_id
      WHERE i.token = ? AND i.status = 'pending'
    `)
    .get(token);

  if (!invite) {
    const err = new Error('Convite não encontrado');
    err.status = 404;
    throw err;
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE vault_invites SET status = 'expired' WHERE id = ?").run(invite.id);
    const err = new Error('Convite expirado');
    err.status = 410;
    throw err;
  }

  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    const err = new Error('Este convite foi enviado para outro email');
    err.status = 403;
    throw err;
  }

  const existing = db
    .prepare('SELECT * FROM vault_members WHERE vault_id = ? AND user_id = ?')
    .get(invite.vault_id, user.id);

  if (existing) {
    db.prepare("UPDATE vault_invites SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?").run(invite.id);
    return {
      vault: db.prepare('SELECT * FROM vaults WHERE id = ?').get(invite.vault_id),
      role: existing.role,
      invite: serializeInvite({ ...invite, status: 'accepted' })
    };
  }

  db.prepare(`
    INSERT INTO vault_members (id, vault_id, user_id, role)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), invite.vault_id, user.id, invite.role);

  db.prepare("UPDATE vault_invites SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?").run(invite.id);

  return {
    vault: db.prepare('SELECT * FROM vaults WHERE id = ?').get(invite.vault_id),
    role: invite.role,
    invite: serializeInvite({ ...invite, status: 'accepted' })
  };
}

function previewVaultInvite(token) {
  const invite = db
    .prepare(`
      SELECT
        i.*,
        v.name AS vault_name,
        v.description AS vault_description,
        u.name AS invited_by_name,
        u.email AS invited_by_email
      FROM vault_invites i
      JOIN vaults v ON v.id = i.vault_id
      JOIN users u ON u.id = i.invited_by
      WHERE i.token = ?
    `)
    .get(token);

  return invite ? serializeInvite(invite) : null;
}

function resolveVaultForRequest(userId, vaultId) {
  if (vaultId) {
    return requireVaultAccess(userId, vaultId);
  }

  const personalVault = ensurePersonalVaultForUser(userId);
  return requireVaultAccess(userId, personalVault.id);
}

function getVaultWithRole(userId, vaultId) {
  const access = getVaultMembership(userId, vaultId);
  return access ? serializeVault(access) : null;
}

function listVaultCategories(vaultId) {
  ensureVaultCategories(vaultId);
  let categories = db
    .prepare(`
      SELECT key, name, icon, color, created_at, updated_at
      FROM categories
      WHERE vault_id = ?
      ORDER BY
        CASE key
          ${DEFAULT_CATEGORY_ORDER.map((key, index) => `WHEN '${key}' THEN ${index}`).join('\n          ')}
          ELSE 999
        END,
        name COLLATE NOCASE ASC
    `)
    .all(vaultId)
    .map((row) => ({
      key: row.key,
      name: row.name,
      icon: row.icon,
      color: row.color,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

  if (!categories.length) {
    ensureVaultCategories(vaultId);
    categories = db
      .prepare(`
        SELECT key, name, icon, color, created_at, updated_at
        FROM categories
        WHERE vault_id = ?
        ORDER BY
          CASE key
            ${DEFAULT_CATEGORY_ORDER.map((key, index) => `WHEN '${key}' THEN ${index}`).join('\n            ')}
            ELSE 999
          END,
          name COLLATE NOCASE ASC
      `)
      .all(vaultId)
      .map((row) => ({
        key: row.key,
        name: row.name,
        icon: row.icon,
        color: row.color,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
  }

  return categories;
}

function getCategoryByKey(vaultId, key) {
  if (!key) return null;
  ensureVaultCategories(vaultId);
  return db
    .prepare('SELECT key, name, icon, color FROM categories WHERE vault_id = ? AND key = ?')
    .get(vaultId, key) || null;
}

function normalizeCategoryPayload(payload = {}) {
  const name = String(payload.name || '').trim();
  const icon = String(payload.icon || '').trim() || DEFAULT_CATEGORIES.outros.icon;
  const color = String(payload.color || '').trim() || DEFAULT_CATEGORIES.outros.color;
  return { name, icon, color };
}

function createVaultCategory(vaultId, payload = {}, createdByUserId = null) {
  ensureVaultCategories(vaultId, createdByUserId);
  const { name, icon, color } = normalizeCategoryPayload(payload);
  if (!name) {
    const err = new Error('O nome da categoria é obrigatório');
    err.status = 400;
    throw err;
  }

  const existingNames = db
    .prepare('SELECT key, name FROM categories WHERE vault_id = ?')
    .all(vaultId);
  const baseKey = slugifyCategoryName(name) || `categoria-${Date.now()}`;
  const existingKeys = new Set(existingNames.map((row) => row.key));
  let nextKey = baseKey;
  let suffix = 2;
  while (existingKeys.has(nextKey)) {
    nextKey = `${baseKey}-${suffix++}`;
  }

  const safeIcon = ICON_OPTIONS.includes(icon) ? icon : icon.slice(0, 4) || DEFAULT_CATEGORIES.outros.icon;
  const safeColor = COLOR_OPTIONS.includes(color) ? color : DEFAULT_CATEGORIES.outros.color;
  const row = {
    id: uuidv4(),
    vault_id: vaultId,
    key: nextKey,
    name,
    icon: safeIcon,
    color: safeColor,
    created_by: createdByUserId
  };

  db.prepare(`
    INSERT INTO categories (id, vault_id, key, name, icon, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.vault_id, row.key, row.name, row.icon, row.color, row.created_by);

  return getCategoryByKey(vaultId, nextKey);
}

function updateVaultCategory(vaultId, categoryKey, payload = {}) {
  ensureVaultCategories(vaultId);
  const current = getCategoryByKey(vaultId, categoryKey);
  if (!current) return null;

  const nextName = payload.name !== undefined ? String(payload.name).trim() : current.name;
  const nextIcon = payload.icon !== undefined ? String(payload.icon).trim() : current.icon;
  const nextColor = payload.color !== undefined ? String(payload.color).trim() : current.color;

  const safeIcon = ICON_OPTIONS.includes(nextIcon) ? nextIcon : current.icon;
  const safeColor = COLOR_OPTIONS.includes(nextColor) ? nextColor : current.color;
  const safeName = nextName || current.name;

  db.prepare(`
    UPDATE categories
    SET name = ?, icon = ?, color = ?, updated_at = CURRENT_TIMESTAMP
    WHERE vault_id = ? AND key = ?
  `).run(safeName, safeIcon, safeColor, vaultId, categoryKey);

  return getCategoryByKey(vaultId, categoryKey);
}

function deleteVaultCategory(vaultId, categoryKey) {
  ensureVaultCategories(vaultId);
  if (!categoryKey || DEFAULT_CATEGORIES[categoryKey]) {
    const err = new Error('Esta categoria não pode ser apagada');
    err.status = 400;
    throw err;
  }

  const current = getCategoryByKey(vaultId, categoryKey);
  if (!current) return null;

  const fallback = getCategoryByKey(vaultId, 'outros') || listVaultCategories(vaultId)[0];
  if (fallback) {
    db.prepare('UPDATE documents SET category = ? WHERE vault_id = ? AND category = ?').run(fallback.key, vaultId, categoryKey);
  }

  db.prepare('DELETE FROM categories WHERE vault_id = ? AND key = ?').run(vaultId, categoryKey);
  return current;
}

module.exports = {
  acceptVaultInvite,
  createVault,
  createVaultCategory,
  createVaultInvite,
  ensurePersonalVaultForUser,
  canRolePerform,
  deleteVaultCategory,
  ensureVaultCategories,
  getCategoryByKey,
  logVaultAction,
  getVaultMembership,
  getVaultWithRole,
  listAccessibleVaults,
  listVaultAudit,
  listVaultCategories,
  listVaultInvites,
  listVaultMembers,
  normalizeRole,
  normalizeCategoryPayload,
  requireVaultAccess,
  requireVaultPermission,
  previewVaultInvite,
  resolveVaultForRequest,
  serializeVault,
  updateVaultCategory,
  deleteVaultAndContent,
  updateVault
};
