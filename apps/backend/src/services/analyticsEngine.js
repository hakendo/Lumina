const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCachedRows(datasetId) {
  const entry = CACHE.get(datasetId);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.rows;
  return null;
}

function setCachedRows(datasetId, rows) {
  CACHE.set(datasetId, { rows, ts: Date.now() });
}

function invalidateCache(datasetId) {
  CACHE.delete(datasetId);
}

async function loadRows(datasetId) {
  const cached = getCachedRows(datasetId);
  if (cached) return cached;

  const dbRows = await prisma.datasetRow.findMany({
    where: { datasetId },
    orderBy: { rowIndex: 'asc' },
    select: { rowData: true },
  });
  const rows = dbRows.map((r) => r.rowData);
  setCachedRows(datasetId, rows);
  return rows;
}

function toNumber(val) {
  if (val === null || val === undefined || val === '') return NaN;
  const n = Number(val);
  return n;
}

function computeAggregate(nums, op) {
  const valid = nums.filter((n) => !isNaN(n));
  if (!valid.length) return null;
  switch (op) {
    case 'sum': return valid.reduce((a, b) => a + b, 0);
    case 'avg': return valid.reduce((a, b) => a + b, 0) / valid.length;
    case 'min': return Math.min(...valid);
    case 'max': return Math.max(...valid);
    case 'count': return valid.length;
    case 'distinct': return new Set(valid).size;
    default: return null;
  }
}

async function aggregate(datasetId, { field, op = 'sum', groupBy, filters }) {
  let rows = await loadRows(datasetId);

  if (filters?.length) {
    for (const f of filters) {
      if (!f.field || f.value === undefined) continue;
      rows = rows.filter((r) => String(r[f.field] ?? '') === String(f.value));
    }
  }

  if (!groupBy) {
    const nums = rows.map((r) => toNumber(r[field]));
    return { value: computeAggregate(nums, op), count: rows.length };
  }

  const groups = new Map();
  for (const row of rows) {
    const key = String(row[groupBy] ?? '(vacío)');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(toNumber(row[field]));
  }

  const result = [];
  for (const [key, nums] of groups) {
    result.push({ group: key, value: computeAggregate(nums, op), count: nums.length });
  }

  result.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { groups: result, totalGroups: result.length, totalRows: rows.length };
}

async function getDistinctValues(datasetId, field, limit = 200) {
  const rows = await loadRows(datasetId);
  const values = new Set();
  for (const row of rows) {
    values.add(row[field] ?? null);
    if (values.size >= limit) break;
  }
  return [...values];
}

async function getStats(datasetId, field) {
  const rows = await loadRows(datasetId);
  const nums = rows.map((r) => toNumber(r[field])).filter((n) => !isNaN(n));
  if (!nums.length) return { count: rows.length, numericCount: 0 };

  nums.sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: rows.length,
    numericCount: nums.length,
    sum,
    avg: sum / nums.length,
    min: nums[0],
    max: nums[nums.length - 1],
    median: nums.length % 2 === 0
      ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
      : nums[Math.floor(nums.length / 2)],
  };
}

module.exports = { aggregate, getDistinctValues, getStats, invalidateCache };
