const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { CronExpressionParser } = require('cron-parser');
const workerAuth = require('../middleware/workerAuth');
const { updateOrgStorage, rowBytes } = require('./datasets');

const router = express.Router();
const prisma = new PrismaClient();

const BATCH_SIZE = 5000;
const CLAIM_TIMEOUT_MINUTES = 10;

async function batchCreateRows(datasetId, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await prisma.datasetRow.createMany({
      data: rows.slice(i, i + BATCH_SIZE).map((row, j) => ({
        datasetId,
        rowData: row,
        rowIndex: i + j,
      })),
    });
  }
}

function isDue(job, now) {
  try {
    const interval = CronExpressionParser.parse(job.cronExpression, {
      currentDate: job.lastRunAt || job.createdAt,
    });
    return interval.next().getTime() <= now.getTime();
  } catch {
    return false; // expresión inválida — no debería pasar (se valida al crear/editar)
  }
}

router.use(workerAuth);

// GET /worker/jobs/due — jobs activos cuyo próximo disparo (según cronExpression
// + última ejecución) ya pasó. Los marca como 'claimed' para que dos polls no
// tomen el mismo job dos veces; un job 'claimed' hace más de
// CLAIM_TIMEOUT_MINUTES sin resolverse vuelve a estar disponible.
router.get('/jobs/due', async (req, res) => {
  const now = new Date();
  const staleClaimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MINUTES * 60_000);

  const candidates = await prisma.scheduledJob.findMany({
    where: {
      isActive: true,
      OR: [
        { status: 'idle' },
        { status: 'claimed', claimedAt: { lt: staleClaimCutoff } },
      ],
    },
  });

  const due = candidates.filter((job) => isDue(job, now));

  const claimed = [];
  for (const job of due) {
    const updated = await prisma.scheduledJob.updateMany({
      where: { id: job.id, status: job.status }, // evita doble-claim si otro poll llegó primero
      data: { status: 'claimed', claimedAt: now },
    });
    if (updated.count > 0) {
      claimed.push({ id: job.id, name: job.name, datasetId: job.datasetId, config: job.config });
    }
  }

  res.json(claimed);
});

// POST /worker/jobs/:id/rows — reemplaza las filas del dataset destino con
// las que trae el worker. Mismo patrón que performSync sin idField
// (datasets.js): borra todo y re-inserta.
router.post('/jobs/:id/rows', async (req, res) => {
  const job = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  if (job.status !== 'claimed') {
    return res.status(409).json({ error: 'Job no está claimed (ya resuelto o reclamado por otro poll)' });
  }

  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows debe ser un array' });

  const dataset = await prisma.dataset.findUnique({ where: { id: job.datasetId } });
  if (!dataset) return res.status(404).json({ error: 'Dataset destino no encontrado' });

  const oldRows = await prisma.datasetRow.findMany({ where: { datasetId: job.datasetId }, select: { rowData: true } });
  const oldBytes = oldRows.reduce((acc, r) => acc + rowBytes(r.rowData), 0);
  const newBytes = rows.reduce((acc, r) => acc + rowBytes(r), 0);

  await prisma.datasetRow.deleteMany({ where: { datasetId: job.datasetId } });
  await batchCreateRows(job.datasetId, rows);
  await updateOrgStorage(dataset, newBytes - oldBytes);

  await prisma.dataset.update({
    where: { id: job.datasetId },
    data: { config: { ...dataset.config, lastSyncAt: new Date().toISOString() } },
  });

  await prisma.jobRun.create({
    data: { jobId: job.id, status: 'ok', rowCount: rows.length, finishedAt: new Date() },
  });
  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: { status: 'idle', claimedAt: null, lastRunAt: new Date(), lastStatus: 'ok', lastError: null, lastRowCount: rows.length },
  });

  res.json({ ok: true, count: rows.length });
});

// POST /worker/jobs/:id/fail — el worker reporta que no pudo completar el job.
router.post('/jobs/:id/fail', async (req, res) => {
  const job = await prisma.scheduledJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  if (job.status !== 'claimed') {
    return res.status(409).json({ error: 'Job no está claimed (ya resuelto o reclamado por otro poll)' });
  }

  const { error } = req.body;
  const errorMessage = typeof error === 'string' ? error.slice(0, 2000) : 'Error desconocido';

  await prisma.jobRun.create({
    data: { jobId: job.id, status: 'error', errorMessage, finishedAt: new Date() },
  });
  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: { status: 'idle', claimedAt: null, lastRunAt: new Date(), lastStatus: 'error', lastError: errorMessage },
  });

  await prisma.notification.create({
    data: {
      userId: job.createdById,
      type: 'job_failed',
      payload: { jobId: job.id, jobName: job.name, error: errorMessage },
    },
  });

  res.json({ ok: true });
});

module.exports = router;
