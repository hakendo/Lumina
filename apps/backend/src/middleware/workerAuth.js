const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Autenticación de servicio para el worker externo — separada del JWT humano
// (auth.js). El worker envía el token en claro por header; aquí solo se
// compara contra el hash guardado, nunca se persiste el valor en claro.
module.exports = async function workerAuthMiddleware(req, res, next) {
  const token = req.headers['x-worker-token'];
  if (!token) return res.status(401).json({ error: 'X-Worker-Token requerido' });

  const record = await prisma.workerToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.revokedAt) {
    return res.status(401).json({ error: 'Token inválido o revocado' });
  }

  await prisma.workerToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  req.workerToken = record;
  next();
};

module.exports.hashToken = hashToken;
