const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const orgAdmin = require('../middleware/orgAdmin');

const prisma = new PrismaClient();

// Verifica que el usuario tenga acceso de admin a la org del área
async function requireAreaAdmin(req, res, area) {
  if (!area) { res.status(404).json({ error: 'Área no encontrada' }); return false; }
  if (req.orgUser.role === 'superadmin') return true;
  if (req.orgUser.orgId !== area.orgId) {
    res.status(403).json({ error: 'Sin acceso a esta área' });
    return false;
  }
  return true;
}

// ── Áreas de la org del usuario autenticado ───────────────────────

router.get('/', auth, async (req, res) => {
  const { orgId } = req.user;
  if (!orgId) return res.status(403).json({ error: 'Sin organización asignada' });

  const areas = await prisma.area.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { members: true, datasets: true, reports: true } },
    },
  });
  res.json(areas);
});

// ── Mis áreas (donde soy miembro) ────────────────────────────────

router.get('/mine', auth, async (req, res) => {
  const memberships = await prisma.areaMember.findMany({
    where: { userId: req.user.id },
    include: {
      area: {
        include: { _count: { select: { members: true, datasets: true, reports: true } } },
      },
    },
    orderBy: { area: { createdAt: 'asc' } },
  });
  res.json(memberships.map((m) => m.area));
});

// ── Crear área (org_admin o superadmin) ──────────────────────────

router.post('/', auth, orgAdmin, async (req, res) => {
  const orgId = req.orgUser.role === 'superadmin' ? req.body.orgId : req.orgUser.orgId;
  if (!orgId) return res.status(400).json({ error: 'orgId requerido' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name es obligatorio' });

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const area = await prisma.area.create({
    data: { orgId, name },
    include: { _count: { select: { members: true, datasets: true, reports: true } } },
  });
  res.status(201).json(area);
});

router.patch('/:id', auth, orgAdmin, async (req, res) => {
  const area = await prisma.area.findUnique({ where: { id: req.params.id } });
  if (!await requireAreaAdmin(req, res, area)) return;

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name es obligatorio' });

  res.json(await prisma.area.update({ where: { id: area.id }, data: { name } }));
});

router.delete('/:id', auth, orgAdmin, async (req, res) => {
  const area = await prisma.area.findUnique({ where: { id: req.params.id } });
  if (!await requireAreaAdmin(req, res, area)) return;
  await prisma.area.delete({ where: { id: area.id } });
  res.json({ ok: true });
});

// ── Miembros del área ─────────────────────────────────────────────

router.get('/:id/members', auth, async (req, res) => {
  const area = await prisma.area.findUnique({ where: { id: req.params.id } });
  if (!area) return res.status(404).json({ error: 'Área no encontrada' });

  // Solo miembros del área o admins pueden ver la lista
  const isMember = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId: area.id, userId: req.user.id } },
  });
  const isAdmin = ['org_admin', 'superadmin'].includes(req.user.role);
  if (!isMember && !isAdmin) return res.status(403).json({ error: 'Sin acceso' });

  const members = await prisma.areaMember.findMany({
    where: { areaId: area.id },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  res.json(members);
});

router.post('/:id/members', auth, orgAdmin, async (req, res) => {
  const area = await prisma.area.findUnique({ where: { id: req.params.id } });
  if (!await requireAreaAdmin(req, res, area)) return;

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.orgId !== area.orgId && req.orgUser.role !== 'superadmin') {
    return res.status(400).json({ error: 'El usuario no pertenece a esta organización' });
  }

  const member = await prisma.areaMember.upsert({
    where: { areaId_userId: { areaId: area.id, userId } },
    create: { areaId: area.id, userId },
    update: {},
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.status(201).json(member);
});

router.delete('/:id/members/:userId', auth, orgAdmin, async (req, res) => {
  const area = await prisma.area.findUnique({ where: { id: req.params.id } });
  if (!await requireAreaAdmin(req, res, area)) return;

  const member = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId: area.id, userId: req.params.userId } },
  });
  if (!member) return res.status(404).json({ error: 'Miembro no encontrado' });

  await prisma.areaMember.delete({
    where: { areaId_userId: { areaId: area.id, userId: req.params.userId } },
  });
  res.json({ ok: true });
});

module.exports = router;
