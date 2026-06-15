const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

router.use(require('../middleware/auth'));
router.use(require('../middleware/superAdmin'));

const USER_SELECT = {
  id: true, email: true, name: true, role: true, orgId: true, isActive: true,
  mfaEnabled: true, mfaEnforced: true, createdAt: true,
  org: { select: { id: true, name: true } },
  _count: { select: { reports: true } },
};

const ROLES = ['member', 'org_admin', 'superadmin'];

// ── Organizaciones ────────────────────────────────────────────────

router.get('/orgs', async (req, res) => {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { users: true, areas: true } },
    },
  });
  res.json(orgs);
});

router.post('/orgs', async (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name y slug son obligatorios' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug solo puede contener letras minúsculas, números y guiones' });

  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) return res.status(409).json({ error: 'Ese slug ya está en uso' });

  const org = await prisma.organization.create({ data: { name, slug } });
  res.status(201).json(org);
});

router.patch('/orgs/:id', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { name, isActive } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (isActive !== undefined) data.isActive = Boolean(isActive);

  res.json(await prisma.organization.update({ where: { id: org.id }, data }));
});

router.delete('/orgs/:id', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  await prisma.organization.delete({ where: { id: org.id } });
  res.json({ ok: true });
});

// ── Áreas ─────────────────────────────────────────────────────────

router.get('/orgs/:orgId/areas', async (req, res) => {
  const areas = await prisma.area.findMany({
    where: { orgId: req.params.orgId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  });
  res.json(areas);
});

router.post('/orgs/:orgId/areas', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name es obligatorio' });

  const area = await prisma.area.create({
    data: { orgId: org.id, name },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  });
  res.status(201).json(area);
});

router.patch('/orgs/:orgId/areas/:areaId', async (req, res) => {
  const area = await prisma.area.findFirst({ where: { id: req.params.areaId, orgId: req.params.orgId } });
  if (!area) return res.status(404).json({ error: 'Área no encontrada' });

  const { name } = req.body;
  res.json(await prisma.area.update({
    where: { id: area.id },
    data: { name },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  }));
});

router.delete('/orgs/:orgId/areas/:areaId', async (req, res) => {
  const area = await prisma.area.findFirst({ where: { id: req.params.areaId, orgId: req.params.orgId } });
  if (!area) return res.status(404).json({ error: 'Área no encontrada' });
  await prisma.area.delete({ where: { id: area.id } });
  res.json({ ok: true });
});

// ── Vista global de reportes (superadmin) ─────────────────────────

router.get('/orgs/:orgId/reports', async (req, res) => {
  const reports = await prisma.report.findMany({
    where: { owner: { orgId: req.params.orgId } },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      area: { select: { id: true, name: true } },
      _count: { select: { widgets: true, pages: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(reports);
});

// Modificación directa por superadmin: transferir reporte a otro área
router.patch('/reports/:reportId', async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.reportId } });
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

  const { areaId, ownerId } = req.body;
  const data = {};
  if (areaId !== undefined) {
    if (areaId !== null) {
      const area = await prisma.area.findUnique({ where: { id: areaId } });
      if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    }
    data.areaId = areaId;
  }
  if (ownerId !== undefined) {
    const user = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    data.ownerId = ownerId;
  }
  res.json(await prisma.report.update({ where: { id: report.id }, data }));
});

// ── Usuarios ──────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const { orgId } = req.query;
  const where = orgId ? { orgId } : {};
  const users = await prisma.user.findMany({ where, select: USER_SELECT, orderBy: { createdAt: 'asc' } });
  res.json(users);
});

router.post('/users', async (req, res) => {
  const { email, password, name, role = 'member', orgId, mfaEnforced = false } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, contraseña y nombre son obligatorios' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (role !== 'superadmin' && !orgId) return res.status(400).json({ error: 'orgId es obligatorio para usuarios no-superadmin' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Ese email ya está registrado' });

  if (orgId) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, role, orgId: orgId || null, mfaEnforced: Boolean(mfaEnforced) },
    select: USER_SELECT,
  });
  res.status(201).json(user);
});

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, role, isActive, password, mfaEnforced, orgId } = req.body;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (id === req.adminUser.id && (role === 'member' || role === 'org_admin' || isActive === false)) {
    return res.status(400).json({ error: 'No puedes degradar ni desactivar tu propia cuenta' });
  }
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });

  if (target.role === 'superadmin' && (role === 'member' || role === 'org_admin' || isActive === false)) {
    const admins = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super admin activo' });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  if (mfaEnforced !== undefined) data.mfaEnforced = Boolean(mfaEnforced);
  if (orgId !== undefined) data.orgId = orgId || null;
  if (email !== undefined && email !== target.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) return res.status(409).json({ error: 'Ese email ya está registrado' });
    data.email = email;
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
  res.json(user);
});

router.post('/users/:id/mfa/reset', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { mfaEnabled: false, mfaSecret: null },
    select: USER_SELECT,
  });
  res.json(user);
});

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.adminUser.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (target.role === 'superadmin') {
    const admins = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super admin activo' });
  }

  await prisma.$transaction([
    prisma.userFavorite.deleteMany({ where: { userId: id } }),
    prisma.reportWidget.updateMany({ where: { dataset: { uploadedById: id } }, data: { datasetId: null } }),
    prisma.report.deleteMany({ where: { ownerId: id } }),
    prisma.dataset.deleteMany({ where: { uploadedById: id } }),
    prisma.user.delete({ where: { id } }),
  ]);
  res.json({ ok: true });
});

module.exports = router;
