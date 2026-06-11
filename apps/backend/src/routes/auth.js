const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt } = require('../services/encryption');
const authMiddleware = require('../middleware/auth');

const prisma = new PrismaClient();

// Tolera 1 paso de desfase de reloj (±30s) al validar códigos TOTP
authenticator.options = { window: 1 };

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, mfaEnabled: u.mfaEnabled };
}

function sessionToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Token intermedio del reto MFA: corto y con stage, nunca sirve como sesión
// (el middleware auth rechaza cualquier token con stage).
function challengeToken(user, stage) {
  return jwt.sign({ id: user.id, stage }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

// Acepta token de sesión o token de reto con stage permitido (para el flujo
// de setup obligatorio en login, donde aún no hay sesión).
function requireSessionOrStage(...stages) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (payload.stage && !stages.includes(payload.stage)) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// Sin registro público: las cuentas las crea el super admin (POST /admin/users)
// y la primera cuenta se crea con scripts/create-super-admin.js.

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.isActive) {
    return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
  }
  if (user.mfaEnabled) {
    return res.json({ mfaRequired: true, mfaToken: challengeToken(user, 'mfa') });
  }
  if (user.mfaEnforced) {
    return res.json({ mfaSetupRequired: true, mfaToken: challengeToken(user, 'mfa-setup') });
  }
  res.json({ token: sessionToken(user), user: publicUser(user) });
});

// Segundo paso del login con MFA activo: token de reto + código TOTP
router.post('/mfa/verify', requireSessionOrStage('mfa'), async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret) {
    return res.status(400).json({ error: 'MFA no está activo en esta cuenta' });
  }
  const { secret } = decrypt(user.mfaSecret);
  // 400 (no 401): el interceptor del frontend trata 401 como sesión muerta
  if (!code || !authenticator.check(String(code), secret)) {
    return res.status(400).json({ error: 'Código incorrecto' });
  }
  res.json({ token: sessionToken(user), user: publicUser(user) });
});

// Genera secreto + QR. Vale con sesión (activación voluntaria) o con token
// de reto 'mfa-setup' (activación obligatoria impuesta por el admin en login).
router.post('/mfa/setup', requireSessionOrStage('mfa-setup'), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive) return res.status(400).json({ error: 'Cuenta no válida' });
  if (user.mfaEnabled) return res.status(400).json({ error: 'MFA ya está activo' });

  const secret = authenticator.generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: encrypt({ secret }) }, // pendiente hasta confirmar con /mfa/enable
  });
  const otpauth = authenticator.keyuri(user.email, 'Lúmina', secret);
  const qr = await QRCode.toDataURL(otpauth);
  res.json({ secret, otpauth, qr });
});

// Confirma el setup con un código válido y activa MFA
router.post('/mfa/enable', requireSessionOrStage('mfa-setup'), async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive || user.mfaEnabled || !user.mfaSecret) {
    return res.status(400).json({ error: 'Primero genera el código QR' });
  }
  const { secret } = decrypt(user.mfaSecret);
  if (!code || !authenticator.check(String(code), secret)) {
    return res.status(400).json({ error: 'Código incorrecto' });
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  res.json({ token: sessionToken(updated), user: publicUser(updated) });
});

// Desactivación voluntaria (requiere código vigente; no permitida si el admin la exige)
router.post('/mfa/disable', authMiddleware, async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    return res.status(400).json({ error: 'MFA no está activo' });
  }
  if (user.mfaEnforced) {
    return res.status(403).json({ error: 'El administrador exige MFA en esta cuenta' });
  }
  const { secret } = decrypt(user.mfaSecret);
  if (!code || !authenticator.check(String(code), secret)) {
    return res.status(400).json({ error: 'Código incorrecto' });
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null },
  });
  res.json({ user: publicUser(updated) });
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true, mfaEnabled: true, mfaEnforced: true, createdAt: true },
  });
  res.json(user);
});

module.exports = router;
