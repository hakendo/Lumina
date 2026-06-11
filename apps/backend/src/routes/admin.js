const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

router.use(require('../middleware/auth'));
router.use(require('../middleware/superAdmin'));

const USER_SELECT = {
  id: true, email: true, name: true, role: true, isActive: true,
  mfaEnabled: true, mfaEnforced: true, createdAt: true,
  _count: { select: { datasets: true, reports: true } },
};

const ROLES = ['user', 'superadmin'];

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({ select: USER_SELECT, orderBy: { createdAt: 'asc' } });
  res.json(users);
});

router.post('/users', async (req, res) => {
  const { email, password, name, role = 'user', mfaEnforced = false } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, contraseña y nombre son obligatorios' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Ese email ya está registrado' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, role, mfaEnforced: Boolean(mfaEnforced) },
    select: USER_SELECT,
  });
  res.status(201).json(user);
});

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, role, isActive, password, mfaEnforced } = req.body;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Un admin no puede quitarse el rol ni desactivarse a sí mismo
  if (id === req.adminUser.id && (role === 'user' || isActive === false)) {
    return res.status(400).json({ error: 'No puedes degradar ni desactivar tu propia cuenta' });
  }
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });

  // Nunca dejar el sistema sin un super admin activo
  if (target.role === 'superadmin' && (role === 'user' || isActive === false)) {
    const admins = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super admin activo' });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  if (mfaEnforced !== undefined) data.mfaEnforced = Boolean(mfaEnforced);
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

// Resetea MFA: el usuario vuelve a entrar solo con contraseña
// (y repite el setup en el próximo login si mfaEnforced sigue activo)
router.post('/users/:id/mfa/reset', async (req, res) => {
  const { id } = req.params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  const user = await prisma.user.update({
    where: { id },
    data: { mfaEnabled: false, mfaSecret: null },
    select: USER_SELECT,
  });
  res.json(user);
});

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.adminUser.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (target.role === 'superadmin') {
    const admins = await prisma.user.count({ where: { role: 'superadmin', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un super admin activo' });
  }

  // User→Dataset/Report no tienen onDelete: Cascade en el schema, así que la
  // limpieza es explícita y en orden: primero las referencias cruzadas.
  await prisma.$transaction([
    prisma.userFavorite.deleteMany({ where: { userId: id } }),
    // Widgets de OTROS reportes que apuntan a datasets de este usuario
    prisma.reportWidget.updateMany({ where: { dataset: { ownerId: id } }, data: { datasetId: null } }),
    prisma.report.deleteMany({ where: { ownerId: id } }), // cascada: widgets, shares, favoritos
    prisma.dataset.deleteMany({ where: { ownerId: id } }), // cascada: rows
    prisma.user.delete({ where: { id } }), // cascada: reportShares recibidos
  ]);
  res.json({ ok: true });
});

module.exports = router;
