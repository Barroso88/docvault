const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { DB_PATH, DB_DIR, FILES_DIR } = require('./paths');
const { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ORDER, slugifyCategoryName } = require('../utils/categoryDefaults');

fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS google_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    google_sub TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL UNIQUE,
    picture TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_user_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    is_personal INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vault_members (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vault_id) REFERENCES vaults(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vault_invites (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    invited_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME,
    expires_at DATETIME,
    FOREIGN KEY(vault_id) REFERENCES vaults(id) ON DELETE CASCADE,
    FOREIGN KEY(invited_by) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'surface',
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vault_id) REFERENCES vaults(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    document_id TEXT,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vault_id) REFERENCES vaults(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    vault_id TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT,
    description TEXT,
    tags TEXT,
    file_name TEXT,
    file_size TEXT,
    file_path TEXT,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    favorite INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(vault_id) REFERENCES vaults(id) ON DELETE SET NULL
  );
`);

function getTableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function ensureColumn(table, column, definition) {
  const columns = getTableColumns(table);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureIndex(sql) {
  db.exec(sql);
}

function ensurePersonalVault(userId, userName = '') {
  const existing = db
    .prepare('SELECT * FROM vaults WHERE owner_user_id = ? AND is_personal = 1')
    .get(userId);

  if (existing) return existing;

  const vaultId = uuidv4();
  const label = userName ? `Cofre de ${userName.split(' ')[0]}` : 'Cofre pessoal';
  db.prepare(`
    INSERT INTO vaults (id, name, description, owner_user_id, created_by, is_personal)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(vaultId, label, 'Espaço privado por defeito', userId, userId);

  db.prepare(`
    INSERT OR IGNORE INTO vault_members (id, vault_id, user_id, role)
    VALUES (?, ?, ?, 'owner')
  `).run(uuidv4(), vaultId, userId);

  ensureDefaultCategories(vaultId, userId);

  return db.prepare('SELECT * FROM vaults WHERE id = ?').get(vaultId);
}

function backfillLegacyDocuments() {
  const users = db.prepare('SELECT id, name FROM users').all();
  const hasVaultColumn = getTableColumns('documents').includes('vault_id');
  const docs = hasVaultColumn
    ? db.prepare("SELECT id, user_id FROM documents WHERE vault_id IS NULL OR vault_id = ''").all()
    : db.prepare('SELECT id, user_id FROM documents').all();

  const personalVaultByUser = new Map();
  users.forEach((user) => {
    const vault = ensurePersonalVault(user.id, user.name);
    personalVaultByUser.set(user.id, vault.id);
  });

  const updateDocumentVault = db.prepare('UPDATE documents SET vault_id = ? WHERE id = ?');
  const fallbackVault = users.length ? personalVaultByUser.get(users[0].id) : null;

  docs.forEach((doc) => {
    const vaultId = personalVaultByUser.get(doc.user_id) || fallbackVault;
    if (vaultId) updateDocumentVault.run(vaultId, doc.id);
  });
}

function backfillVaultCategories() {
  const vaultIds = db.prepare('SELECT id, owner_user_id, is_personal FROM vaults').all();
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (id, vault_id, key, name, icon, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  vaultIds.forEach((vault) => {
    DEFAULT_CATEGORY_ORDER.forEach((key) => {
      const category = DEFAULT_CATEGORIES[key];
      insertCategory.run(
        uuidv4(),
        vault.id,
        key,
        category.name,
        category.icon,
        category.color,
        vault.owner_user_id || null
      );
    });
  });
}

function ensureDefaultCategories(vaultId, createdByUserId = null) {
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (id, vault_id, key, name, icon, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  DEFAULT_CATEGORY_ORDER.forEach((key) => {
    const category = DEFAULT_CATEGORIES[key];
    insertCategory.run(
      uuidv4(),
      vaultId,
      key,
      category.name,
      category.icon,
      category.color,
      createdByUserId
    );
  });
}

ensureColumn('documents', 'vault_id', 'TEXT');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_vault_key ON categories(vault_id, key);
  CREATE INDEX IF NOT EXISTS idx_categories_vault_id ON categories(vault_id);
`);
backfillLegacyDocuments();
backfillVaultCategories();
ensureIndex('CREATE INDEX IF NOT EXISTS idx_documents_vault_id ON documents(vault_id)');
ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_members_vault_user ON vault_members(vault_id, user_id)');
ensureIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_vaults_personal_owner ON vaults(owner_user_id) WHERE is_personal = 1');
ensureIndex('CREATE INDEX IF NOT EXISTS idx_audit_logs_vault_id ON audit_logs(vault_id)');
ensureIndex('CREATE INDEX IF NOT EXISTS idx_audit_logs_document_id ON audit_logs(document_id)');

module.exports = db;
