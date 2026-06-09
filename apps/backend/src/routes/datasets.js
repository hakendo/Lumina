const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { parseFile, fetchAPI } = require('../services/dataParser');

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

router.get('/', auth, async (req, res) => {
  const datasets = await prisma.dataset.findMany({
    where: { ownerId: req.user.id },
    select: { id: true, name: true, sourceType: true, createdAt: true, _count: { select: { rows: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(datasets);
});

router.post('/', auth, async (req, res) => {
  const { name, sourceType, config } = req.body;
  if (!name || !sourceType) return res.status(400).json({ error: 'name and sourceType required' });
  const dataset = await prisma.dataset.create({
    data: { ownerId: req.user.id, name, sourceType, config: config || {} },
  });
  res.json(dataset);
});

router.post('/:id/upload', auth, upload.single('file'), async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const rows = parseFile(req.file.path, req.file.mimetype);

  await prisma.datasetRow.deleteMany({ where: { datasetId: dataset.id } });
  await prisma.datasetRow.createMany({
    data: rows.map((row, i) => ({ datasetId: dataset.id, rowData: row, rowIndex: i })),
  });
  await prisma.dataset.update({
    where: { id: dataset.id },
    data: { filePath: req.file.path, sourceType: 'csv' },
  });

  res.json({ count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

router.post('/:id/fetch', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || dataset.ownerId !== req.user.id) return res.status(404).json({ error: 'Dataset not found' });

  const rows = await fetchAPI(dataset.config);

  await prisma.datasetRow.deleteMany({ where: { datasetId: dataset.id } });
  await prisma.datasetRow.createMany({
    data: rows.map((row, i) => ({ datasetId: dataset.id, rowData: row, rowIndex: i })),
  });

  res.json({ count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

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
