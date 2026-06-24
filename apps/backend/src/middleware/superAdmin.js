const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verifica rol contra la DB en cada request: un JWT de 7 días no debe
// conservar privilegios si el rol fue revocado o la cuenta desactivada.
module.exports = async function superAdminMiddleware(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Requiere permisos de super administrador' });
  }
  req.adminUser = user;
  next();
};
