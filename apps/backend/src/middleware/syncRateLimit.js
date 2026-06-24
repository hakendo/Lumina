const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Contador de syncs en memoria: { orgId -> { minute: [ts,...], hour: [ts,...], day: [ts,...] } }
const syncLog = new Map();

function pruneWindow(timestamps, windowMs) {
  const cutoff = Date.now() - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

function getLog(orgId) {
  if (!syncLog.has(orgId)) syncLog.set(orgId, { minute: [], hour: [], day: [] });
  return syncLog.get(orgId);
}

// Middleware: verifica rate limit + storage antes de permitir un sync.
// Añadir a las rutas POST /datasets/:id/sync y POST /datasets/sync-all.
module.exports = async function syncRateLimitMiddleware(req, res, next) {
  const orgId = req.user?.orgId;
  if (!orgId) return next(); // superadmin sin contexto de org: sin límite

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { storageUsedMB: true, plan: true },
  });
  if (!org) return next();

  const plan = org.plan;

  // Verificar storage
  if (plan?.storageLimitMB != null && org.storageUsedMB >= plan.storageLimitMB) {
    return res.status(429).json({
      error: 'Límite de almacenamiento alcanzado. Amplía tu plan para sincronizar más datos.',
      code: 'STORAGE_LIMIT',
    });
  }

  // Verificar rate limit de sync
  const rateLimit = plan?.syncRateLimit ?? {};
  if (rateLimit.maxPerMinute == null && rateLimit.maxPerHour == null && rateLimit.maxPerDay == null) {
    return next(); // sin límites configurados
  }

  const log = getLog(orgId);
  const now = Date.now();

  log.minute = pruneWindow(log.minute, 60_000);
  log.hour   = pruneWindow(log.hour,   3_600_000);
  log.day    = pruneWindow(log.day,    86_400_000);

  if (rateLimit.maxPerMinute != null && log.minute.length >= rateLimit.maxPerMinute) {
    return res.status(429).json({ error: 'Límite de syncs por minuto alcanzado', code: 'RATE_LIMIT_MINUTE' });
  }
  if (rateLimit.maxPerHour != null && log.hour.length >= rateLimit.maxPerHour) {
    return res.status(429).json({ error: 'Límite de syncs por hora alcanzado', code: 'RATE_LIMIT_HOUR' });
  }
  if (rateLimit.maxPerDay != null && log.day.length >= rateLimit.maxPerDay) {
    return res.status(429).json({ error: 'Límite de syncs por día alcanzado', code: 'RATE_LIMIT_DAY' });
  }

  log.minute.push(now);
  log.hour.push(now);
  log.day.push(now);

  next();
};
