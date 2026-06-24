const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verifica que el usuario sea org_admin o superadmin en la org activa del JWT.
// Lee la membresía fresca de DB — no confía en el rol del token para la decisión.
// Adjunta req.orgUser con { id, role, orgId } para uso en los handlers.
module.exports = async function orgAdminMiddleware(req, res, next) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, isActive: true, role: true },
  });
  if (!user || !user.isActive) return res.status(401).json({ error: 'Sin sesión válida' });

  // Superadmin tiene acceso total sin membresía
  if (user.role === 'superadmin') {
    req.orgUser = { id: user.id, role: 'superadmin', orgId: req.user.orgId };
    return next();
  }

  const orgId = req.user.orgId;

  // If JWT has an orgId, require org_admin role there (strict scoping)
  if (orgId) {
    const [membership, org] = await Promise.all([
      prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId: user.id, orgId } },
        select: { role: true },
      }),
      prisma.organization.findUnique({ where: { id: orgId }, select: { isActive: true } }),
    ]);
    if (!org?.isActive) return res.status(403).json({ error: 'Esta organización está desactivada' });
    if (!membership || membership.role !== 'org_admin') {
      return res.status(403).json({ error: 'Requiere permisos de administrador de organización' });
    }
    req.orgUser = { id: user.id, role: 'org_admin', orgId };
    return next();
  }

  // JWT has no orgId — fall back to the user's sole org_admin membership (if unambiguous)
  const adminMemberships = await prisma.orgMembership.findMany({
    where: { userId: user.id, role: 'org_admin' },
    select: { orgId: true },
  });
  if (adminMemberships.length === 1) {
    req.orgUser = { id: user.id, role: 'org_admin', orgId: adminMemberships[0].orgId };
    return next();
  }

  return res.status(403).json({ error: 'Sin contexto de organización' });
};
