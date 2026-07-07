const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const syncRateLimit = require('../middleware/syncRateLimit');
const { parseFile, fetchAPI, queryDB, resolveConfig } = require('../services/dataParser');
const { encrypt, decrypt } = require('../services/encryption');
const { introspectSchema } = require('../services/schemaIntrospect');
const { evalExpression } = require('../services/exprEval');
const analytics = require('../services/analyticsEngine');

const prisma = new PrismaClient();

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.ods']);

// SEC-003 + SEC-010: random filename, no path traversal, validated extension
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.UPLOAD_DIR || './uploads';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXTENSIONS.has(ext));
  },
});

const BATCH_SIZE = 5000;

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

function safeConfig(config) {
  if (!config) return {};
  const { _enc, ...safe } = config;
  return safe;
}

function rowBytes(rowData) {
  return Buffer.byteLength(JSON.stringify(rowData), 'utf8');
}

async function updateOrgStorage(areaId, deltaBytes) {
  if (!areaId || Math.abs(deltaBytes) < 1) return;
  const area = await prisma.area.findUnique({ where: { id: areaId }, select: { orgId: true } });
  if (!area?.orgId) return;
  await prisma.organization.update({
    where: { id: area.orgId },
    data: { storageUsedMB: { increment: deltaBytes / (1024 * 1024) } },
  });
}

// Verifica acceso de lectura: miembro del área, uploader, o superadmin
async function canReadDataset(dataset, userId) {
  if (dataset.uploadedById === userId) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return true;

  if (dataset.areaId) {
    const membership = await prisma.areaMember.findUnique({
      where: { areaId_userId: { areaId: dataset.areaId, userId } },
    });
    if (membership) return true;
  }

  // SEC-007: only direct per-user shares grant access (not public reports — those use /public/ endpoint)
  const viaShare = await prisma.reportWidget.findFirst({
    where: { datasetId: dataset.id, report: { shares: { some: { userId } } } },
    select: { id: true },
  });
  return Boolean(viaShare);
}

// Verifica acceso de escritura: uploadedBy o org_admin del área o superadmin
async function canWriteDataset(dataset, userId) {
  if (dataset.uploadedById === userId) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'superadmin') return true;
  if (dataset.areaId) {
    const area = await prisma.area.findUnique({ where: { id: dataset.areaId }, select: { orgId: true } });
    if (area?.orgId) {
      const membership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: area.orgId } },
        select: { role: true },
      });
      return membership?.role === 'org_admin';
    }
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
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  const isSuperadmin = user?.role === 'superadmin';
  // superadmin sees all datasets; regular users see their area datasets
  const where = isSuperadmin
    ? { deletedAt: null }
    : areaIds !== null
      ? { areaId: { in: areaIds }, deletedAt: null }
      : { uploadedById: req.user.id, deletedAt: null };

  const datasets = await prisma.dataset.findMany({
    where,
    select: {
      id: true, name: true, sourceType: true, config: true, createdAt: true,
      areaId: true, slotName: true,
      area: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
      _count: { select: { rows: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(datasets.map((d) => ({ ...d, config: safeConfig(d.config) })));
});

// ── Sync masivo ───────────────────────────────────────────────────
// Must be registered BEFORE /:id routes.

router.post('/sync-all', auth, syncRateLimit, async (req, res) => {
  const areaIds = await getUserAreaIds(req.user.id);
  const where = areaIds !== null
    ? { areaId: { in: areaIds }, sourceType: { in: ['api', 'db'] } }
    : { uploadedById: req.user.id, sourceType: { in: ['api', 'db'] } };

  const datasets = await prisma.dataset.findMany({ where, select: { id: true, name: true, sourceType: true, config: true } });

  const results = [];
  for (const ds of datasets) {
    const r = await performSync(ds);
    results.push({ id: ds.id, name: ds.name, ...r });
  }

  res.json({
    total: results.length,
    synced: results.filter((r) => !r.unchanged && !r.error).length,
    unchanged: results.filter((r) => r.unchanged).length,
    errors: results.filter((r) => r.error).length,
    details: results,
  });
});

// ── Slots de plantilla ────────────────────────────────────────────
// Must be registered BEFORE /:id routes to avoid Express matching /slots as id='slots'

// GET /datasets/slots — list slot bindings pending config for the current user's reports
router.get('/slots', auth, async (req, res) => {
  const bindings = await prisma.datasetSlotBinding.findMany({
    where: { report: { ownerId: req.user.id } },
    include: {
      report: { select: { id: true, title: true, templateId: true } },
      clientDataset: { select: { id: true, name: true, sourceType: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(bindings);
});

// POST /datasets/slots/:id/bind — bind an existing dataset to the slot
router.post('/slots/:id/bind', auth, async (req, res) => {
  const binding = await prisma.datasetSlotBinding.findUnique({
    where: { id: req.params.id },
    include: { report: { select: { ownerId: true } } },
  });
  if (!binding || binding.report.ownerId !== req.user.id) {
    return res.status(404).json({ error: 'Slot no encontrado' });
  }

  const { datasetId } = req.body;
  if (!datasetId) return res.status(400).json({ error: 'datasetId required' });

  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }

  const updated = await prisma.datasetSlotBinding.update({
    where: { id: binding.id },
    data: { clientDatasetId: datasetId },
  });

  // Patch all widgets in this report that carry config.datasetSlot === binding.slotName
  const widgets = await prisma.reportWidget.findMany({
    where: { reportId: binding.reportId },
    select: { id: true, config: true },
  });
  const toUpdate = widgets.filter((w) => w.config?.datasetSlot === binding.slotName);
  await Promise.all(toUpdate.map((w) =>
    prisma.reportWidget.update({
      where: { id: w.id },
      data: { datasetId, config: { ...w.config, datasetSlot: w.config.datasetSlot } },
    })
  ));

  res.json({ ...updated, widgetsUpdated: toUpdate.length });
});

// PATCH /:id/id-field — save the chosen unique-key field for upsert deduplication.
// idField = null means "explicitly no key" (won't ask again). Must be before GET /:id.
router.patch('/:id/id-field', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (!['api', 'db'].includes(dataset.sourceType)) return res.status(400).json({ error: 'Solo datasets API y DB soportan idField' });

  const { idField } = req.body; // string = campo ID; null = sin campo ID (explícito)
  const { _enc, ...pub } = dataset.config;
  await prisma.dataset.update({
    where: { id: dataset.id },
    data: { config: { ...pub, _enc, idField: idField ?? null } },
  });
  res.json({ idField: idField ?? null });
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
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  const isSuperadmin = user?.role === 'superadmin';
  if (!areaId && !isSuperadmin) return res.status(400).json({ error: 'areaId required' });

  if (areaId) {
    const canAccess = await prisma.areaMember.findUnique({
      where: { areaId_userId: { areaId, userId: req.user.id } },
    });
    if (!canAccess && !isSuperadmin) return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const rows = await parseFile(req.file.path, req.file.mimetype);

  const dataset = await prisma.dataset.create({
    data: { areaId: areaId || null, uploadedById: req.user.id, name, sourceType: 'csv', filePath: req.file.path, config: { lastSyncAt: new Date().toISOString() } },
  });
  await batchCreateRows(dataset.id, rows);

  const uploadedBytes = rows.reduce((acc, r) => acc + rowBytes(r), 0);
  await updateOrgStorage(dataset.areaId, uploadedBytes);

  res.json({ id: dataset.id, name: dataset.name, count: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
});

// ── API connector ─────────────────────────────────────────────────

router.post('/api-connector', auth, async (req, res) => {
  const { name, areaId, url, method = 'GET', headers = {}, queryParams = {}, body, dataPath, allowInsecureSsl = false, slotName } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!url?.trim()) return res.status(400).json({ error: 'url required' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  const isSuperadmin = user?.role === 'superadmin';
  if (!areaId && !isSuperadmin) return res.status(400).json({ error: 'areaId required' });

  if (areaId) {
    const canAccess = await prisma.areaMember.findUnique({
      where: { areaId_userId: { areaId, userId: req.user.id } },
    });
    if (!canAccess && !isSuperadmin) return res.status(403).json({ error: 'Sin acceso a esa área' });
  }
  // SEC-013: allowInsecureSsl only for admins
  if (allowInsecureSsl && !['org_admin', 'superadmin'].includes(user?.role)) {
    return res.status(403).json({ error: 'Solo administradores pueden deshabilitar la validación SSL' });
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
    data: { areaId: areaId || null, uploadedById: req.user.id, name, sourceType: 'api', config, slotName: slotName?.trim() || null },
  });

  res.json({ id: dataset.id, name: dataset.name, slotName: dataset.slotName, config: safeConfig(config) });
});

router.put('/:id/api-connector', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'api') return res.status(400).json({ error: 'Dataset is not an API connector' });

  const { name, url, method, headers, queryParams, body, dataPath, allowInsecureSsl } = req.body;

  // SEC-013: allowInsecureSsl only for admins
  if (allowInsecureSsl) {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
    if (!['org_admin', 'superadmin'].includes(user?.role)) {
      return res.status(403).json({ error: 'Solo administradores pueden deshabilitar la validación SSL' });
    }
  }
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

const VALID_DB_TYPES = new Set(['pg', 'mysql', 'mssql', 'oracle', 'redis']);
const VISUAL_DB_TYPES = new Set(['pg', 'mysql', 'mssql', 'oracle']);

router.post('/db-connector/introspect', auth, async (req, res) => {
  try {
    const { dbType, connectionString, datasetId } = req.body;

    let connStr = connectionString;
    let engine = dbType;

    if (datasetId) {
      const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
      if (!dataset || dataset.sourceType !== 'db') return res.status(404).json({ error: 'Dataset no encontrado' });
      if (!(await canWriteDataset(dataset, req.user.id))) return res.status(403).json({ error: 'Sin acceso' });
      const resolved = resolveConfig(dataset.config);
      connStr = resolved.connectionString;
      engine = resolved.dbType || dataset.config.dbType;
    }

    if (!connStr) return res.status(400).json({ error: 'connectionString o datasetId requerido' });
    if (!VISUAL_DB_TYPES.has(engine)) return res.status(400).json({ error: `Introspección no soportada para ${engine}` });

    const schema = await introspectSchema(engine, connStr);
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/db-connector/estimate', auth, async (req, res) => {
  try {
    const { dbType, connectionString, datasetId, query } = req.body;
    if (!query?.trim()) return res.status(400).json({ error: 'query requerida' });

    let connStr = connectionString;
    let engine = dbType;

    if (datasetId) {
      const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
      if (!dataset || dataset.sourceType !== 'db') return res.status(404).json({ error: 'Dataset no encontrado' });
      if (!(await canWriteDataset(dataset, req.user.id))) return res.status(403).json({ error: 'Sin acceso' });
      const resolved = resolveConfig(dataset.config);
      connStr = resolved.connectionString;
      engine = resolved.dbType || dataset.config.dbType;
    }

    if (!connStr) return res.status(400).json({ error: 'connectionString o datasetId requerido' });

    const { estimateQueryCost } = require('../services/queryCostEstimator');
    const estimate = await estimateQueryCost(engine, connStr, query);
    res.json(estimate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/db-connector/build-query', auth, async (req, res) => {
  try {
    const { dbType, connectionString, datasetId, definition } = req.body;

    let connStr = connectionString;
    let engine = dbType;

    if (datasetId) {
      const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
      if (!dataset || dataset.sourceType !== 'db') return res.status(404).json({ error: 'Dataset no encontrado' });
      if (!(await canWriteDataset(dataset, req.user.id))) return res.status(403).json({ error: 'Sin acceso' });
      const resolved = resolveConfig(dataset.config);
      connStr = resolved.connectionString;
      engine = resolved.dbType || dataset.config.dbType;
    }

    if (!connStr) return res.status(400).json({ error: 'connectionString o datasetId requerido' });
    if (!definition?.tables?.length) return res.status(400).json({ error: 'Selecciona al menos una tabla' });

    const schema = await introspectSchema(engine, connStr);
    const { buildSelectQuery } = require('../services/sqlBuilder');
    const query = buildSelectQuery(definition, engine, schema);
    res.json({ query, warnings: [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function wrapQueryWithLimit(query, dbType, limit) {
  const sub = query.trim().replace(/;\s*$/, '');
  if (dbType === 'mssql') return `SELECT TOP ${limit} * FROM (${sub}) AS __preview_sub`;
  if (dbType === 'oracle') return `SELECT * FROM (${sub}) __preview_sub WHERE ROWNUM <= ${limit}`;
  return `SELECT * FROM (${sub}) AS __preview_sub LIMIT ${limit}`;
}

router.post('/db-connector/preview-query', auth, async (req, res) => {
  try {
    const { dbType, connectionString, datasetId, query } = req.body;
    if (!query?.trim()) return res.status(400).json({ error: 'query requerida' });

    let connStr = connectionString;
    let engine = dbType;

    if (datasetId) {
      const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
      if (!dataset || dataset.sourceType !== 'db') return res.status(404).json({ error: 'Dataset no encontrado' });
      if (!(await canWriteDataset(dataset, req.user.id))) return res.status(403).json({ error: 'Sin acceso' });
      const resolved = resolveConfig(dataset.config);
      connStr = resolved.connectionString;
      engine = resolved.dbType || dataset.config.dbType;
    }

    if (!connStr) return res.status(400).json({ error: 'connectionString o datasetId requerido' });

    const limit = Math.min(Math.max(parseInt(req.body.limit, 10) || 50, 1), 1000);
    const wrapped = wrapQueryWithLimit(query, engine, limit);
    const rows = await queryDB({ dbType: engine, connectionString: connStr, query: wrapped });
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    res.json({ rows, columns, count: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/db-connector', auth, async (req, res) => {
  const { name, areaId, dbType = 'pg', connectionString, query, slotName, visualDefinition } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  if (!connectionString?.trim()) return res.status(400).json({ error: 'connectionString required' });
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });
  if (!VALID_DB_TYPES.has(dbType)) return res.status(400).json({ error: `Tipo de BD no soportado: ${dbType}` });

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  const isSuperadmin = user?.role === 'superadmin';
  if (!areaId && !isSuperadmin) return res.status(400).json({ error: 'areaId required' });

  if (areaId) {
    const canAccess = await prisma.areaMember.findUnique({
      where: { areaId_userId: { areaId, userId: req.user.id } },
    });
    if (!canAccess && !isSuperadmin) return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const config = { dbType, query, _enc: encrypt({ connectionString }), ...(visualDefinition && { visualDefinition }) };
  const dataset = await prisma.dataset.create({
    data: { areaId: areaId || null, uploadedById: req.user.id, name, sourceType: 'db', config, slotName: slotName?.trim() || null },
  });

  res.json({ id: dataset.id, name: dataset.name, slotName: dataset.slotName, config: safeConfig(config) });
});

router.put('/:id/db-connector', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'db') return res.status(400).json({ error: 'Dataset is not a DB connector' });

  const { name, dbType, connectionString, query, visualDefinition } = req.body;
  const existingPublic = safeConfig(dataset.config);
  const publicConfig = {
    dbType: dbType ?? existingPublic.dbType,
    query: query ?? existingPublic.query,
    ...(visualDefinition !== undefined ? { visualDefinition } : (existingPublic.visualDefinition ? { visualDefinition: existingPublic.visualDefinition } : {})),
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
  if (!sources?.length) return res.status(400).json({ error: 'al menos un dataset fuente requerido' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true } });
  const isSuperadmin = user?.role === 'superadmin';
  if (!areaId && !isSuperadmin) return res.status(400).json({ error: 'areaId required' });

  if (areaId) {
    const canAccess = await prisma.areaMember.findUnique({
      where: { areaId_userId: { areaId, userId: req.user.id } },
    });
    if (!canAccess && !isSuperadmin) return res.status(403).json({ error: 'Sin acceso a esa área' });
  }

  const { joins = [], columns = [], filters = [] } = req.body;
  const config = { sources, joins, columns, filters };

  const dataset = await prisma.dataset.create({
    data: { areaId: areaId || null, uploadedById: req.user.id, name, sourceType: 'derived', config },
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

// SEC-004: load and join source datasets in memory for a derived dataset.
// Returns { rows, error } — rows is the full computed result set.
async function computeDerived(dataset, userId) {
  const { sources = [], joins = [], columns = [], filters = [] } = dataset.config;
  const sourceData = {};
  for (const src of sources) {
    const srcDs = await prisma.dataset.findUnique({ where: { id: src.datasetId } });
    if (!srcDs || !(await canReadDataset(srcDs, userId))) {
      return { rows: null, error: 'Sin acceso a un dataset fuente' };
    }
    let srcRows;
    if (srcDs.sourceType === 'db') {
      srcRows = await queryDB(srcDs.config);
    } else {
      const rawRows = await prisma.datasetRow.findMany({
        where: { datasetId: src.datasetId },
        orderBy: { rowIndex: 'asc' },
        select: { rowData: true },
      });
      srcRows = rawRows.map((r) => r.rowData);
    }
    sourceData[src.alias || src.datasetId] = srcRows;
  }

  let result = sourceData[sources[0]?.alias || sources[0]?.datasetId] || [];
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
      for (const rightRow of matches) merged.push({ ...leftRow, ...rightRow });
    }
    result = merged;
  }

  if (columns.length) {
    result = result.map((row) => {
      const extra = {};
      for (const col of columns) extra[col.name] = evalExpression(col.expression, row);
      return { ...row, ...extra };
    });
  }

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

  return { rows: result };
}

// Vista previa del Dataset Derivado — limita a 200 filas para el editor
router.get('/:id/derived/preview', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (dataset.sourceType !== 'derived') return res.status(400).json({ error: 'Dataset is not derived' });

  const { rows, error } = await computeDerived(dataset, req.user.id);
  if (error) return res.status(403).json({ error });
  res.json({ rows: rows.slice(0, 200), total: rows.length });
});

// ── Fetch / sync ──────────────────────────────────────────────────

// Compute a short deterministic hash of row data for change detection.
// Keys are sorted so {a:1,b:2} and {b:2,a:1} produce the same hash.
function hashRows(rows) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) {
    const sorted = {};
    for (const k of Object.keys(row).sort()) sorted[k] = row[k];
    hash.update(JSON.stringify(sorted));
  }
  return hash.digest('hex').slice(0, 16);
}

// Shared sync logic used by both individual fetch and sync-all.
// Returns { count, unchanged, error?, errorType? }
async function performSync(dataset) {
  let rows;
  try {
    rows = dataset.sourceType === 'api'
      ? await fetchAPI(dataset.config)
      : await queryDB(dataset.config);
  } catch (err) {
    const errorType = err.errorType ?? 'connection_error';
    const { _enc, ...pub } = dataset.config;
    await prisma.dataset.update({
      where: { id: dataset.id },
      data: { config: { ...pub, _enc, lastSyncStatus: errorType, lastSyncError: err.message, lastSyncAt: new Date().toISOString() } },
    });
    return { count: 0, unchanged: false, error: err.message, errorType };
  }

  const { _enc, ...pub } = dataset.config;
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  // DB connectors are live-query: never cache rows locally, just record metadata.
  if (dataset.sourceType === 'db') {
    await prisma.dataset.update({
      where: { id: dataset.id },
      data: { config: { ...pub, _enc, lastSyncStatus: 'ok', lastSyncError: null, lastSyncAt: new Date().toISOString() } },
    });
    analytics.invalidateCache(dataset.id);
    return { count: rows.length, unchanged: false, columns };
  }

  const newHash = hashRows(rows);

  if (pub.dataHash === newHash) {
    return { count: rows.length, unchanged: true };
  }

  const idField = pub.idField; // undefined = not configured yet, null = no ID, string = use for upsert

  let storageDeltaBytes = 0;

  if (idField && rows[0]?.[idField] !== undefined) {
    const existing = await prisma.datasetRow.findMany({
      where: { datasetId: dataset.id },
      select: { id: true, rowData: true },
    });
    const existingMap = new Map(existing.map((r) => [String(r.rowData[idField]), r]));
    const newKeys = new Set(rows.map((r) => String(r[idField])));

    const toUpdate = [];
    const toCreate = [];

    for (let i = 0; i < rows.length; i++) {
      const key = String(rows[i][idField]);
      const ex = existingMap.get(key);
      if (ex) {
        toUpdate.push({ id: ex.id, rowData: rows[i], rowIndex: i });
      } else {
        toCreate.push({ datasetId: dataset.id, rowData: rows[i], rowIndex: i });
        storageDeltaBytes += rowBytes(rows[i]);
      }
    }

    const UPDATE_BATCH = 500;
    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
      const batch = toUpdate.slice(i, i + UPDATE_BATCH);
      await prisma.$transaction(
        batch.map((u) => prisma.datasetRow.update({ where: { id: u.id }, data: { rowData: u.rowData, rowIndex: u.rowIndex } }))
      );
    }

    if (toCreate.length) {
      await batchCreateRows(dataset.id, toCreate.map((c) => c.rowData));
    }

    const toDelete = existing.filter((r) => !newKeys.has(String(r.rowData[idField])));
    if (toDelete.length) {
      storageDeltaBytes -= toDelete.reduce((acc, r) => acc + rowBytes(r.rowData), 0);
      await prisma.datasetRow.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
    }
  } else {
    // Default: full replace — compute delta from old rows before deleting
    const oldRows = await prisma.datasetRow.findMany({ where: { datasetId: dataset.id }, select: { rowData: true } });
    const oldBytes = oldRows.reduce((acc, r) => acc + rowBytes(r.rowData), 0);
    const newBytes = rows.reduce((acc, r) => acc + rowBytes(r), 0);
    storageDeltaBytes = newBytes - oldBytes;

    await prisma.datasetRow.deleteMany({ where: { datasetId: dataset.id } });
    await batchCreateRows(dataset.id, rows);
  }

  await updateOrgStorage(dataset.areaId, storageDeltaBytes);

  await prisma.dataset.update({
    where: { id: dataset.id },
    data: { config: { ...pub, _enc, dataHash: newHash, lastSyncStatus: 'ok', lastSyncError: null, lastSyncAt: new Date().toISOString() } },
  });

  analytics.invalidateCache(dataset.id);

  const needsIdConfig = !('idField' in pub);
  return { count: rows.length, unchanged: false, columns, needsIdConfig };
}

router.post('/:id/fetch', auth, syncRateLimit, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  if (!['api', 'db'].includes(dataset.sourceType)) {
    return res.status(400).json({ error: 'Only api and db datasets can be fetched' });
  }

  const result = await performSync(dataset);
  if (result.error) return res.status(502).json({ error: result.error, errorType: result.errorType });
  res.json({ count: result.count, unchanged: result.unchanged, columns: result.columns ?? [] });
});

// ── Rows / columns ────────────────────────────────────────────────

router.get('/:id/rows', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  if (dataset.sourceType === 'derived') {
    const { rows, error } = await computeDerived(dataset, req.user.id);
    if (error) return res.status(403).json({ error });
    return res.json(rows);
  }

  if (dataset.sourceType === 'db') {
    const resolved = resolveConfig(dataset.config);
    const engine = resolved.dbType || dataset.config.dbType;
    const wrapped = wrapQueryWithLimit(resolved.query, engine, 50000);
    const rows = await queryDB({ ...resolved, query: wrapped });
    return res.json(rows);
  }

  const page = parseInt(req.query.page, 10);
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 10000, 50000);

  if (page > 0) {
    const total = await prisma.datasetRow.count({ where: { datasetId: dataset.id } });
    const rows = await prisma.datasetRow.findMany({
      where: { datasetId: dataset.id },
      orderBy: { rowIndex: 'asc' },
      select: { rowData: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return res.json({
      rows: rows.map((r) => r.rowData),
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    });
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
  if (dataset.sourceType === 'derived') {
    const { rows, error } = await computeDerived(dataset, req.user.id);
    if (error) return res.status(403).json({ error });
    return res.json(rows[0] ? Object.keys(rows[0]) : []);
  }
  if (dataset.sourceType === 'db') {
    const resolved = resolveConfig(dataset.config);
    const engine = resolved.dbType || dataset.config.dbType;
    const wrapped = wrapQueryWithLimit(resolved.query, engine, 1);
    const rows = await queryDB({ ...resolved, query: wrapped });
    return res.json(rows[0] ? Object.keys(rows[0]) : []);
  }
  const first = await prisma.datasetRow.findFirst({ where: { datasetId: req.params.id }, orderBy: { rowIndex: 'asc' } });
  if (!first) return res.json([]);
  res.json(Object.keys(first.rowData));
});

// SEC-003: serve raw uploaded file through authenticated route only
router.get('/:id/file', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  if (!dataset.filePath || !fs.existsSync(dataset.filePath)) {
    return res.status(404).json({ error: 'File not available' });
  }
  const ext = path.extname(dataset.filePath);
  const mimeMap = { '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.ods': 'application/vnd.oasis.opendocument.spreadsheet' };
  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  const safeName = dataset.name.replace(/[\x00-\x1f\x7f"\\]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}${ext}"; filename*=UTF-8''${encodeURIComponent(dataset.name)}${ext}`);
  fs.createReadStream(dataset.filePath).pipe(res);
});

router.delete('/:id', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canWriteDataset(dataset, req.user.id))) return res.status(404).json({ error: 'Dataset not found' });
  // Soft-delete: va a papelera, el Org Admin puede recuperarlo
  await prisma.dataset.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  analytics.invalidateCache(req.params.id);
  res.json({ ok: true });
});

// ── Analytics (server-side aggregation) ──────────────────────────

router.get('/:id/aggregate', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  const { field, op = 'sum', groupBy } = req.query;
  if (!field) return res.status(400).json({ error: 'field param required' });

  const validOps = ['sum', 'avg', 'min', 'max', 'count', 'distinct'];
  if (!validOps.includes(op)) return res.status(400).json({ error: `op must be one of: ${validOps.join(', ')}` });

  const filters = req.query.filters ? JSON.parse(req.query.filters) : [];
  const result = await analytics.aggregate(dataset.id, { field, op, groupBy, filters });
  res.json(result);
});

router.get('/:id/stats', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  const { field } = req.query;
  if (!field) return res.status(400).json({ error: 'field param required' });
  res.json(await analytics.getStats(dataset.id, field));
});

router.get('/:id/distinct', auth, async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset || !(await canReadDataset(dataset, req.user.id))) {
    return res.status(404).json({ error: 'Dataset not found' });
  }
  const { field, limit } = req.query;
  if (!field) return res.status(400).json({ error: 'field param required' });
  res.json(await analytics.getDistinctValues(dataset.id, field, parseInt(limit, 10) || 200));
});

module.exports = router;
