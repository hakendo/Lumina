const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verifica que el usuario sea org_admin o superadmin activo.
// Adjunta req.orgUser con datos frescos de DB (no confiar en JWT para roles).
module.exports = async function orgAdminMiddleware(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'Sin sesión válida' });
  if (!['org_admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({ error: 'Requiere permisos de administrador de organización' });
  }
  req.orgUser = user;
  next();
};
