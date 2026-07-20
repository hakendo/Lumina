const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('../services/encryption');
const authMiddleware = require('../middleware/auth');

const prisma = new PrismaClient();

authenticator.options = { window: 1 };

// Devuelve la membresía activa del usuario para el orgId dado,
// o null si es superadmin. Usado para construir el JWT y /me.
async function resolveMembership(user, orgId) {
  if (user.role === 'superadmin') return { role: 'superadmin', orgId: null };
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    include: { org: { select: { id: true, name: true, slug: true } } },
  });
  if (!m) return null;
  return { role: m.role, orgId: m.orgId, orgName: m.org.name, orgSlug: m.org.slug };
}

// Elige la org activa al login: la más reciente por joinedAt.
// El usuario puede cambiarla después con /auth/switch-org.
async function defaultMembership(user) {
  if (user.role === 'superadmin') return { role: 'superadmin', orgId: null };
  const m = await prisma.orgMembership.findFirst({
    where: { userId: user.id, org: { isActive: true } },
    orderBy: { joinedAt: 'desc' },
    include: { org: { select: { id: true, name: true, slug: true } } },
  });
  if (!m) return null;
  return { role: m.role, orgId: m.orgId, orgName: m.org.name, orgSlug: m.org.slug };
}

function publicUser(u, membership) {
  const isSuperadmin = u.role === 'superadmin';
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: isSuperadmin ? 'superadmin' : (membership?.role ?? 'member'),
    orgId: membership?.orgId ?? null,
    orgName: membership?.orgName ?? null,
    orgSlug: membership?.orgSlug ?? null,
    mfaEnabled: u.mfaEnabled,
  };
}

function sessionToken(user, membership) {
  const isSuperadmin = user.role === 'superadmin';
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: isSuperadmin ? 'superadmin' : (membership?.role ?? 'member'),
      orgId: membership?.orgId ?? null,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Token intermedio del reto MFA: corto y con stage, nunca sirve como sesión
function challengeToken(user, stage) {
  return jwt.sign({ id: user.id, stage }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

function requireSessionOrStage(...stages) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ error: 'No token provided' });
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (payload.stage && !stages.includes(payload.stage))
        return res.status(401).json({ error: 'Invalid token' });
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: 'Credenciales inválidas' });
  if (!user.isActive)
    return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
  if (user.mfaEnabled)
    return res.json({ mfaRequired: true, mfaToken: challengeToken(user, 'mfa') });
  if (user.mfaEnforced)
    return res.json({ mfaSetupRequired: true, mfaToken: challengeToken(user, 'mfa-setup') });

  const membership = await defaultMembership(user);
  res.json({ token: sessionToken(user, membership), user: publicUser(user, membership) });
});

// Cambia la org activa del usuario y emite un nuevo JWT con ese contexto.
// El frontend llama a este endpoint cuando el usuario selecciona otra org.
router.post('/switch-org', authMiddleware, async (req, res) => {
  const { orgId } = req.body;
  if (!orgId) return res.status(400).json({ error: 'orgId requerido' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'Cuenta no válida' });

  // Superadmin puede operar en cualquier org sin membresía
  let membership;
  if (user.role === 'superadmin') {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true },
    });
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    membership = { role: 'superadmin', orgId: org.id, orgName: org.name, orgSlug: org.slug };
  } else {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { isActive: true } });
    if (!org?.isActive) return res.status(403).json({ error: 'Esta organización está desactivada' });
    membership = await resolveMembership(user, orgId);
    if (!membership) return res.status(403).json({ error: 'No perteneces a esa organización' });
  }

  res.json({ token: sessionToken(user, membership), user: publicUser(user, membership) });
});

router.post('/mfa/verify', requireSessionOrStage('mfa'), async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret)
    return res.status(400).json({ error: 'MFA no está activo en esta cuenta' });
  const { secret } = decrypt(user.mfaSecret);
  if (!code || !authenticator.check(String(code), secret))
    return res.status(400).json({ error: 'Código incorrecto' });

  const membership = await defaultMembership(user);
  res.json({ token: sessionToken(user, membership), user: publicUser(user, membership) });
});

router.post('/mfa/setup', requireSessionOrStage('mfa-setup'), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive) return res.status(400).json({ error: 'Cuenta no válida' });
  if (user.mfaEnabled) return res.status(400).json({ error: 'MFA ya está activo' });

  const secret = authenticator.generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: encrypt({ secret }) },
  });
  const otpauth = authenticator.keyuri(user.email, 'Lúmina', secret);
  const qr = await QRCode.toDataURL(otpauth);
  res.json({ otpauth, qr });
});

router.post('/mfa/enable', requireSessionOrStage('mfa-setup'), async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive || user.mfaEnabled || !user.mfaSecret)
    return res.status(400).json({ error: 'Primero genera el código QR' });
  const { secret } = decrypt(user.mfaSecret);
  if (!code || !authenticator.check(String(code), secret))
    return res.status(400).json({ error: 'Código incorrecto' });

  const updated = await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  const membership = await defaultMembership(updated);
  res.json({ token: sessionToken(updated, membership), user: publicUser(updated, membership) });
});

router.post('/mfa/disable', authMiddleware, async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.mfaEnabled || !user.mfaSecret)
    return res.status(400).json({ error: 'MFA no está activo' });
  if (user.mfaEnforced)
    return res.status(403).json({ error: 'El administrador exige MFA en esta cuenta' });
  const { secret } = decrypt(user.mfaSecret);
  if (!code || !authenticator.check(String(code), secret))
    return res.status(400).json({ error: 'Código incorrecto' });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null },
  });
  res.json({ user: publicUser(updated, null) });
});

router.patch('/me/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword y newPassword son obligatorios' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(400).json({ error: 'Contraseña actual incorrecta' });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, email: true, name: true, role: true,
      mfaEnabled: true, mfaEnforced: true, createdAt: true,
      memberships: {
        select: {
          role: true,
          org: { select: { id: true, name: true, slug: true, isActive: true, themeConfig: true } },
        },
      },
    },
  });
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

  // Resolve active org from JWT
  const activeOrgId = req.user.orgId ?? null;
  const activeMembership = user.memberships.find((m) => m.org.id === activeOrgId) ?? null;

  // Superadmin puede tener orgId en el token sin tener membership — fetch org directo
  let activeOrg = activeMembership?.org ?? null;
  if (!activeOrg && activeOrgId && user.role === 'superadmin') {
    activeOrg = await prisma.organization.findUnique({
      where: { id: activeOrgId },
      select: { id: true, name: true, slug: true, isActive: true, themeConfig: true },
    });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === 'superadmin' ? 'superadmin' : (activeMembership?.role ?? 'member'),
    orgId: activeOrgId,
    orgName: activeOrg?.name ?? null,
    orgSlug: activeOrg?.slug ?? null,
    // Overrides de tokens visuales de la org activa (ver ThemeProvider en el frontend).
    // Objeto vacío = usar los defaults de la app.
    orgTheme: activeOrg?.themeConfig ?? {},
    mfaEnabled: user.mfaEnabled,
    mfaEnforced: user.mfaEnforced,
    createdAt: user.createdAt,
    orgs: user.memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      isActive: m.org.isActive,
      role: m.role,
    })),
  });
});

module.exports = router;
