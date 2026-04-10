const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/db');
const {
  acceptVaultInvite,
  createVault,
  createVaultInvite,
  createVaultCategory,
  deleteVaultAndContent,
  deleteVaultCategory,
  getVaultMembership,
  listVaultCategories,
  listAccessibleVaults,
  listVaultAudit,
  listVaultInvites,
  listVaultMembers,
  normalizeRole,
  previewVaultInvite,
  requireVaultAccess,
  requireVaultPermission,
  logVaultAction,
  updateVaultCategory,
  updateVault
} = require('../utils/vaults');

const router = express.Router();

function handleError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || 'Erro inesperado' });
}

router.get('/', auth, (req, res) => {
  const vaults = listAccessibleVaults(req.user.id);
  const activeVaultId = req.query.vaultId || vaults.find((vault) => vault.is_personal)?.id || vaults[0]?.id || null;

  res.json({
    vaults,
    activeVaultId
  });
});

router.get('/invites/:token', (req, res) => {
  const invite = previewVaultInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Convite não encontrado' });
  res.json({ invite });
});

router.post('/invites/:token/accept', auth, (req, res) => {
  try {
    const result = acceptVaultInvite({ token: req.params.token, user: req.user });
    logVaultAction({
      vaultId: result.vault.id,
      actorUserId: req.user.id,
      action: 'invite.accepted',
      details: { token: req.params.token, role: result.role }
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', auth, (req, res) => {
  try {
    const { name, description } = req.body;
    const vault = createVault({ name, description, createdByUser: req.user });
    const member = getVaultMembership(req.user.id, vault.id);
    logVaultAction({
      vaultId: vault.id,
      actorUserId: req.user.id,
      action: 'vault.created',
      details: { name: vault.name, description: vault.description }
    });
    res.status(201).json({
      ...vault,
      role: member?.role || 'owner'
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:vaultId', auth, (req, res) => {
  try {
    const vault = requireVaultAccess(req.user.id, req.params.vaultId);
    const members = listVaultMembers(req.params.vaultId);
    const invites = listVaultInvites(req.params.vaultId);
    const categories = listVaultCategories(req.params.vaultId);
    const member = getVaultMembership(req.user.id, req.params.vaultId);

    res.json({
      vault,
      role: member?.role || null,
      members,
      invites,
      categories
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:vaultId', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'manage');

    const vault = updateVault(req.params.vaultId, req.body || {});
    if (!vault) return res.status(404).json({ error: 'Cofre não encontrado' });

    logVaultAction({
      vaultId: req.params.vaultId,
      actorUserId: req.user.id,
      action: 'vault.updated',
      details: {
        name: req.body?.name || null,
        description: req.body?.description || null
      }
    });

    res.json(vault);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:vaultId/categories', auth, (req, res) => {
  try {
    requireVaultAccess(req.user.id, req.params.vaultId);
    res.json({ categories: listVaultCategories(req.params.vaultId) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:vaultId/categories', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'manage');
    const category = createVaultCategory(req.params.vaultId, req.body || {}, req.user.id);
    logVaultAction({
      vaultId: req.params.vaultId,
      actorUserId: req.user.id,
      action: 'category.created',
      details: category
    });
    res.status(201).json({ category });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:vaultId/categories/:categoryKey', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'manage');
    const category = updateVaultCategory(req.params.vaultId, req.params.categoryKey, req.body || {});
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada' });
    logVaultAction({
      vaultId: req.params.vaultId,
      actorUserId: req.user.id,
      action: 'category.updated',
      details: category
    });
    res.json({ category });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:vaultId/categories/:categoryKey', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'manage');
    const deleted = deleteVaultCategory(req.params.vaultId, req.params.categoryKey);
    if (!deleted) return res.status(404).json({ error: 'Categoria não encontrada' });
    logVaultAction({
      vaultId: req.params.vaultId,
      actorUserId: req.user.id,
      action: 'category.deleted',
      details: deleted
    });
    res.json({ success: true, category: deleted });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:vaultId', auth, (req, res) => {
  try {
    const access = requireVaultPermission(req.user.id, req.params.vaultId, 'manage');
    if (access.vault?.is_personal) {
      return res.status(400).json({ error: 'O cofre pessoal não pode ser apagado' });
    }

    const result = deleteVaultAndContent(req.params.vaultId);
    if (!result) return res.status(404).json({ error: 'Cofre não encontrado' });

    res.json({
      success: true,
      deletedDocuments: result.documentsDeleted,
      deletedFiles: result.deletedFiles.length,
      failedFiles: result.failedFiles.length
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:vaultId/members', auth, (req, res) => {
  try {
    requireVaultAccess(req.user.id, req.params.vaultId);
    res.json({ members: listVaultMembers(req.params.vaultId) });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:vaultId/invites', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'invite');
    res.json({ invites: listVaultInvites(req.params.vaultId) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:vaultId/invites', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'invite');

    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'O email é obrigatório' });

    const invite = createVaultInvite({
      vaultId: req.params.vaultId,
      email,
      role,
      invitedByUser: req.user
    });

    logVaultAction({
      vaultId: req.params.vaultId,
      actorUserId: req.user.id,
      action: 'invite.created',
      details: {
        email,
        role: invite.role,
        token: invite.token
      }
    });

    res.status(201).json({
      invite,
      inviteLink: `${req.protocol}://${req.get('host')}/invite/${invite.token}`
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:vaultId/members/:memberId', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'manage');

    const target = db.prepare('SELECT * FROM vault_members WHERE vault_id = ? AND user_id = ?').get(
      req.params.vaultId,
      req.params.memberId
    );

    if (!target) return res.status(404).json({ error: 'Membro não encontrado' });
    if (normalizeRole(target.role) === 'owner') {
      return res.status(400).json({ error: 'Não podes remover o dono do cofre' });
    }

    db.prepare('DELETE FROM vault_members WHERE vault_id = ? AND user_id = ?').run(req.params.vaultId, req.params.memberId);
    logVaultAction({
      vaultId: req.params.vaultId,
      actorUserId: req.user.id,
      action: 'member.removed',
      details: {
        memberId: req.params.memberId
      }
    });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:vaultId/audit', auth, (req, res) => {
  try {
    requireVaultPermission(req.user.id, req.params.vaultId, 'audit');
    const audit = listVaultAudit(req.params.vaultId, Number(req.query.limit || 50));
    res.json({ audit });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
