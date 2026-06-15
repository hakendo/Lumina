const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { parseFile, fetchAPI, queryDB } = require('../services/dataParser');
const { encrypt, decrypt } = require('../services/encryption');
const { evalExpression } = require('../services/exprEval');

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

function safeConfig(config) {
  if (!config) return {};
  const { _enc, ...safe } = config;
  return safe;
}

// Verifica acceso de lectura: miembro del área o superadmin
async function canReadDataset(dataset, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return true;

  if (dataset.areaId) {
    const membership = await prisma.areaMember.findUnique({
      where: { areaId_userId: { areaId: dataset.areaId, userId } },
    });
    if (membership) return true;
  }

  // Acceso via reporte compartido o público (compatibilidad con sharing por persona)
  const viaReport = await prisma.reportWidget.findFirst({
    where: {
      datasetId: dataset.id,
      report: { OR: [{ isPublic: true }, { shares: { some: { userId } } }] },
    },
    select: { id: true },
  });
  return Boolean(viaReport);
}

// Verifica acceso de escritura: uploadedBy o org_admin del área o superadmin
async function canWriteDataset(dataset, userId) {
  if (dataset.uploadedById === userId) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, orgId: true } });
  if (user?.role === 'superadmin') return true;
  if (user?.role === 'org_admin' && dataset.areaId) {
    const area = await prisma.area.findUnique({ where: { id: dataset.areaId }, select: { orgId: true } });
    return area?.orgId === user.orgId;
  }
  return false;
}

// Obtiene áreas del usuario para filtrar datasets visibles
async function getUserAreaIds(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return null; // null = sin filtro
  const memberships = await prisma.areaMember.findMany({
    where: { userId },
    select: { areaId: true },
  });
  return memberships.map((m) => m.areaId);
}

// ── Listar datasets del usuario (sus áreas) ───────────────────────

router.get('/', auth, async (req, res) => {
  const areaIds = await getUserAreaIds(req.user.id);
  const where = areaIds ? { areaId: { in: areaIds } } : {};

  const datasets = await prisma.dataset.findMany({
    where,
    select: {
      id: true, name: true, sourceType: true, config: true, createdAt: true,
      areaId: true,
      area: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
      _count: { select: { rows: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(datasets.map((d) => ({ ...d, config: safeConfig(d.config) })));
});

router.get('/:id', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({
    where: { id: req.params.id },
    include: {
      area: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
  });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  res.json({ ...dataset, config: safeConfig(dataset.config) });
});

// ── CSV / Excel upload ────────────────────────────────────────────

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  const { name, areaId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!areaId) return res.status(400).json({ error: 'areaId required' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const canAccess = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId, userId: req.user.id } },
  });
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  if (!canAccess && user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const rows = parseFile(req.file.path, req.file.mimetype);

  const dataset = await prisma.dataset.create({
    data: { areaId, uploadedById: req.user.id, name, sourceType: 'csv', filePath: req.file.path, config: {} },
  });
  await prisma.datasetRow.createMany({
    data: rows.map((row, i) => ({ datasetId: dataset.id, rowData: row, rowIndex: i })),
  });

  res.json({ id: dataset.id, name: dataset.name, count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

// ── API connector ─────────────────────────────────────────────────

router.post('/api-connector', auth, async (req, res) => {
  const { name, areaId, url, method = 'GET', headers = {}, queryParams = {}, body, dataPath, allowInsecureSsl = false } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!areaId) return res.status(400).json({ error: 'areaId required' });
  if (!url?.trim()) return res.status(400).json({ error: 'url required' });

  const canAccess = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId, userId: req.user.id } },
  });
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  if (!canAccess && user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const publicConfig = {
    url, method, dataPath: dataPath || '',
    headerKeys: Object.keys(headers || {}),
    queryParamKeys: Object.keys(queryParams || {}),
    hasBody: body != null && body !== '',
    allowInsecureSsl: !!allowInsecureSsl,
  };
  const config = { ...publicConfig, _enc: encrypt({ headers, queryParams, body: body || null }) };
  const dataset = await prisma.dataset.create({
    data: { areaId, uploadedById: req.user.id, name, sourceType: 'api', config },
  });

  res.json({ id: dataset.id, name: dataset.name, config: safeConfig(config) });
});

router.put('/:id/api-connector', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'api') return res.status(400).json({ error: 'Dataset is not an API connector' });

  const { name, url, method, headers, queryParams, body, dataPath, allowInsecureSsl } = req.body;
  const existing = safeConfig(dataset.config);
  const sensitive = dataset.config._enc ? decrypt(dataset.config._enc) : { headers: {}, queryParams: {}, body: null };
  if (headers !== undefined) sensitive.headers = headers;
  if (queryParams !== undefined) sensitive.queryParams = queryParams;
  if (body !== undefined) sensitive.body = body;

  const publicConfig = {
    url: url ?? existing.url,
    method: method ?? existing.method ?? 'GET',
    dataPath: dataPath ?? existing.dataPath ?? '',
    headerKeys: Object.keys(sensitive.headers || {}),
    queryParamKeys: Object.keys(sensitive.queryParams || {}),
    hasBody: body !== undefined ? (body != null && body !== '') : (existing.hasBody ?? sensitive.body != null),
    allowInsecureSsl: allowInsecureSsl !== undefined ? !!allowInsecureSsl : !!(existing.allowInsecureSsl),
    lastSyncStatus: existing.lastSyncStatus ?? null,
    lastSyncError: existing.lastSyncError ?? null,
  };
  const config = { ...publicConfig, _enc: encrypt(sensitive) };
  const updated = await prisma.dataset.update({ where: { id: dataset.id }, data: { ...(name && { name }), config } });
  res.json({ ...updated, config: safeConfig(updated.config) });
});

// ── DB connector ──────────────────────────────────────────────────

router.post('/db-connector', auth, async (req, res) => {
  const { name, areaId, dbType = 'pg', connectionString, query } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!areaId) return res.status(400).json({ error: 'areaId required' });
  if (!connectionString?.trim()) return res.status(400).json({ error: 'connectionString required' });
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  const canAccess = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId, userId: req.user.id } },
  });
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  if (!canAccess && user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const config = { dbType, query, _enc: encrypt({ connectionString }) };
  const dataset = await prisma.dataset.create({
    data: { areaId, uploadedById: req.user.id, name, sourceType: 'db', config },
  });

  res.json({ id: dataset.id, name: dataset.name, config: safeConfig(config) });
});

router.put('/:id/db-connector', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'db') return res.status(400).json({ error: 'Dataset is not a DB connector' });

  const { name, dbType, connectionString, query } = req.body;
  const existingPublic = safeConfig(dataset.config);
  const publicConfig = {
    dbType: dbType ?? existingPublic.dbType,
    query: query ?? existingPublic.query,
  };
  const config = connectionString
    ? { ...publicConfig, _enc: encrypt({ connectionString }) }
    : { ...publicConfig, _enc: dataset.config._enc };

  const updated = await prisma.dataset.update({ where: { id: dataset.id }, data: { ...(name && { name }), config } });
  res.json({ ...updated, config: safeConfig(updated.config) });
});

// ── Dataset Derivado ──────────────────────────────────────────────

router.post('/derived', auth, async (req, res) => {
  const { name, areaId, sources } = req.body;
  // sources: [{ datasetId, alias }], joins: [{ left, right, on }], columns: [{ name, expression }]
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!areaId) return res.status(400).json({ error: 'areaId required' });
  if (!sources?.length) return res.status(400).json({ error: 'al menos un dataset fuente requerido' });

  const canAccess = await prisma.areaMember.findUnique({
    where: { areaId_userId: { areaId, userId: req.user.id } },
  });
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  if (!canAccess && user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const { joins = [], columns = [], filters = [] } = req.body;
  const config = { sources, joins, columns, filters };

  const dataset = await prisma.dataset.create({
    data: { areaId, uploadedById: req.user.id, name, sourceType: 'derived', config },
  });
  res.status(201).json({ id: dataset.id, name: dataset.name, config });
});

router.put('/:id/derived', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'derived') return res.status(400).json({ error: 'Dataset is not derived' });

  const { name, sources, joins, columns, filters } = req.body;
  const config = {
    sources: sources ?? dataset.config.sources,
    joins: joins ?? dataset.config.joins ?? [],
    columns: columns ?? dataset.config.columns ?? [],
    filters: filters ?? dataset.config.filters ?? [],
  };
  const updated = await prisma.dataset.update({ where: { id: dataset.id }, data: { ...(name && { name }), config } });
  res.json({ ...updated, config: updated.config });
});

// Vista previa del Dataset Derivado (ejecuta joins/cálculos en memoria)
router.get('/:id/derived/preview', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'derived') return res.status(400).json({ error: 'Dataset is not derived' });

  const { sources, joins, columns, filters } = dataset.config;

  // Cargar filas de todos los datasets fuente
  const sourceData = {};
  for (const src of sources) {
    const rows = await prisma.datasetRow.findMany({
      where: { datasetId: src.datasetId },
      orderBy: { rowIndex: 'asc' },
      select: { rowData: true },
    });
    sourceData[src.alias || src.datasetId] = rows.map((r) => r.rowData);
  }

  // Join simple en memoria (equi-join por columna)
  let result = sourceData[sources[0].alias || sources[0].datasetId] || [];
  for (const join of joins) {
    const rightRows = sourceData[join.rightAlias] || [];
    const rightIndex = {};
    for (const row of rightRows) {
      const key = row[join.rightOn];
      if (!rightIndex[key]) rightIndex[key] = [];
      rightIndex[key].push(row);
    }
    const merged = [];
    for (const leftRow of result) {
      const key = leftRow[join.leftOn];
      const matches = rightIndex[key] || [{}];
      for (const rightRow of matches) {
        merged.push({ ...leftRow, ...rightRow });
      }
    }
    result = merged;
  }

  // Aplicar columnas calculadas usando evaluador seguro (sin eval / new Function)
  if (columns.length) {
    result = result.map((row) => {
      const extra = {};
      for (const col of columns) {
        extra[col.name] = evalExpression(col.expression, row);
      }
      return { ...row, ...extra };
    });
  }

  // Aplicar filtros
  for (const f of filters) {
    result = result.filter((row) => {
      const val = row[f.field];
      if (f.op === 'eq') return val == f.value;
      if (f.op === 'neq') return val != f.value;
      if (f.op === 'gt') return Number(val) > Number(f.value);
      if (f.op === 'lt') return Number(val) < Number(f.value);
      if (f.op === 'contains') return String(val).includes(String(f.value));
      return true;
    });
  }

  res.json({ rows: result.slice(0, 200), total: result.length });
});

// ── Fetch / sync ──────────────────────────────────────────────────

router.post('/:id/fetch', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (!['api', 'db'].includes(dataset.sourceType)) {
    return res.status(400).json({ error: 'Only api and db datasets can be fetched' });
  }

  let rows;
  try {
    rows = dataset.sourceType === 'api' ? await fetchAPI(dataset.config) : await queryDB(dataset.config);
  } catch (err) {
    const errorType = err.errorType ?? 'connection_error';
    const { _enc, ...pub } = dataset.config;
    await prisma.dataset.update({
      where: { id: dataset.id },
      data: { config: { ...pub, _enc, lastSyncStatus: errorType, lastSyncError: err.message } },
    });
    return res.status(502).json({ error: err.message, errorType });
  }

  const { _enc, ...pub } = dataset.config;
  await prisma.datasetRow.deleteMany({ where: { datasetId: dataset.id } });
  await prisma.datasetRow.createMany({
    data: rows.map((row, i) => ({ datasetId: dataset.id, rowData: row, rowIndex: i })),
  });
  await prisma.dataset.update({
    where: { id: dataset.id },
    data: { config: { ...pub, _enc, lastSyncStatus: 'ok', lastSyncError: null } },
  });

  res.json({ count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

// ── Rows / columns ────────────────────────────────────────────────

router.get('/:id/rows', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  const rows = await prisma.datasetRow.findMany({
    where: { datasetId: dataset.id },
    orderBy: { rowIndex: 'asc' },
    select: { rowData: true },
  });
  res.json(rows.map((r) => r.rowData));
});

router.get('/:id/columns', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  const first = await prisma.datasetRow.findFirst({ where: { datasetId: req.params.id }, orderBy: { rowIndex: 'asc' } });
  if (!first) return res.json([]);
  res.json(Object.keys(first.rowData));
});

router.delete('/:id', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  await prisma.dataset.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
