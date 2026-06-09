const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { parseFile, fetchAPI, queryDB } = require('../services/dataParser');
const { encrypt } = require('../services/encryption');

const prisma = new PrismaClient();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.UPLOAD_DIR || './uploads';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Strip the encrypted blob from responses sent to the client.
function safeConfig(config) {
  if (!config) return {};
  const { _enc, ...safe } = config;
  return safe;
}

router.get('/', auth, async (req, res) => {
  const datasets = await prisma.dataset.findMany({
    where: { ownerId: req.user.id },
    select: { id: true, name: true, sourceType: true, config: true, createdAt: true, _count: { select: { rows: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(datasets.map((d) => ({ ...d, config: safeConfig(d.config) })));
});

router.get('/:id', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  res.json({ ...dataset, config: safeConfig(dataset.config) });
});

// ── CSV / Excel upload ──────────────────────────────────────────────────────

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const rows = parseFile(req.file.path, req.file.mimetype);

  const dataset = await prisma.dataset.create({
    data: { ownerId: req.user.id, name, sourceType: 'csv', filePath: req.file.path, config: {} },
  });
  await prisma.datasetRow.createMany({
    data: rows.map((row, i) => ({ datasetId: dataset.id, rowData: row, rowIndex: i })),
  });

  res.json({ id: dataset.id, name: dataset.name, count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

// ── API connector ───────────────────────────────────────────────────────────

router.post('/api-connector', auth, async (req, res) => {
  const { name, url, method = 'GET', headers = {}, body, dataPath } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!url?.trim()) return res.status(400).json({ error: 'url required' });

  // Public (non-sensitive) fields stored in plain text.
  // Sensitive fields (headers may contain API keys, body may contain credentials) — encrypted.
  const publicConfig = { url, method, dataPath: dataPath || '' };
  const sensitiveConfig = { headers, body: body || null };

  const config = { ...publicConfig, _enc: encrypt(sensitiveConfig) };
  const dataset = await prisma.dataset.create({
    data: { ownerId: req.user.id, name, sourceType: 'api', config },
  });

  res.json({ id: dataset.id, name: dataset.name, config: safeConfig(config) });
});

router.put('/:id/api-connector', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'api') return res.status(400).json({ error: 'Dataset is not an API connector' });

  const { name, url, method = 'GET', headers = {}, body, dataPath } = req.body;
  const publicConfig = { url: url ?? dataset.config.url, method, dataPath: dataPath ?? '' };
  const sensitiveConfig = { headers, body: body || null };
  const config = { ...publicConfig, _enc: encrypt(sensitiveConfig) };

  const updated = await prisma.dataset.update({
    where: { id: dataset.id },
    data: { ...(name && { name }), config },
  });
  res.json({ ...updated, config: safeConfig(updated.config) });
});

// ── DB connector ────────────────────────────────────────────────────────────

router.post('/db-connector', auth, async (req, res) => {
  const { name, dbType = 'pg', connectionString, query } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!connectionString?.trim()) return res.status(400).json({ error: 'connectionString required' });
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  // dbType and query are non-sensitive; the connection string (contains credentials) is encrypted.
  const publicConfig = { dbType, query };
  const sensitiveConfig = { connectionString };

  const config = { ...publicConfig, _enc: encrypt(sensitiveConfig) };
  const dataset = await prisma.dataset.create({
    data: { ownerId: req.user.id, name, sourceType: 'db', config },
  });

  res.json({ id: dataset.id, name: dataset.name, config: safeConfig(config) });
});

router.put('/:id/db-connector', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'db') return res.status(400).json({ error: 'Dataset is not a DB connector' });

  const { name, dbType, connectionString, query } = req.body;
  const existingPublic = safeConfig(dataset.config);
  const publicConfig = {
    dbType: dbType ?? existingPublic.dbType,
    query: query ?? existingPublic.query,
  };
  // Only re-encrypt if a new connection string was provided; otherwise keep the existing blob.
  const config = connectionString
    ? { ...publicConfig, _enc: encrypt({ connectionString }) }
    : { ...publicConfig, _enc: dataset.config._enc };

  const updated = await prisma.dataset.update({
    where: { id: dataset.id },
    data: { ...(name && { name }), config },
  });
  res.json({ ...updated, config: safeConfig(updated.config) });
});

// ── Fetch / sync data ───────────────────────────────────────────────────────

router.post('/:id/fetch', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  if (!['api', 'db'].includes(dataset.sourceType)) {
    return res.status(400).json({ error: 'Only api and db datasets can be fetched' });
  }

  let rows;
  if (dataset.sourceType === 'api') {
    rows = await fetchAPI(dataset.config);
  } else {
    rows = await queryDB(dataset.config);
  }

  await prisma.datasetRow.deleteMany({ where: { datasetId: dataset.id } });
  await prisma.datasetRow.createMany({
    data: rows.map((row, i) => ({ datasetId: dataset.id, rowData: row, rowIndex: i })),
  });

  res.json({ count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

// ── Rows / columns ──────────────────────────────────────────────────────────

router.get('/:id/rows', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  const rows = await prisma.datasetRow.findMany({
    where: { datasetId: dataset.id },
    orderBy: { rowIndex: 'asc' },
    select: { rowData: true },
  });
  res.json(rows.map((r) => r.rowData));
});

router.get('/:id/columns', auth, async (req, res) => {
  const first = await prisma.datasetRow.findFirst({ where: { datasetId: req.params.id }, orderBy: { rowIndex: 'asc' } });
  if (!first) return res.json([]);
  res.json(Object.keys(first.rowData));
});

router.delete('/:id', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  await prisma.dataset.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
