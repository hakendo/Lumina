const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { decrypt } = require('./encryption');

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

/**
 * Resolves the sensitive portion of a stored config.
 * Stored config shape: { ...publicFields, _enc: "<token>" }
 * Returns the merged, plain-text config ready for use.
 */
function resolveConfig(storedConfig) {
  if (!storedConfig._enc) return storedConfig;
  const sensitive = decrypt(storedConfig._enc);
  const { _enc, ...pub } = storedConfig;
  return { ...pub, ...sensitive };
}

// Many APIs wrap the row array in an envelope ({ data: [...] }, { results: [...] }…).
// Without an explicit dataPath, look for the first property holding an array of objects.
const ENVELOPE_KEYS = ['data', 'results', 'items', 'rows', 'records'];

function extractRows(json, dataPath) {
  if (dataPath) {
    const value = dataPath.split('.').reduce((obj, key) => obj?.[key], json);
    return Array.isArray(value) ? value : (value !== undefined ? [value] : []);
  }
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const key of [...ENVELOPE_KEYS, ...Object.keys(json)]) {
      const v = json[key];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    }
  }
  return [json];
}

// Widgets render cell values with String(v); nested objects/arrays would show
// as "[object Object]". Store them as JSON text instead.
function normalizeRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return { value: row };
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return out;
}

async function fetchAPI(storedConfig) {
  const config = resolveConfig(storedConfig);
  const { url, method = 'GET', headers = {}, body, dataPath } = config;

  if (!url) throw new Error('API connector is missing a URL');

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API returned ${res.status} ${res.statusText}`);
  const json = await res.json();
  return extractRows(json, dataPath).map(normalizeRow);
}

async function queryDB(storedConfig) {
  const config = resolveConfig(storedConfig);
  const { dbType, connectionString, query } = config;

  if (!connectionString) throw new Error('DB connector is missing a connection string');
  if (!query) throw new Error('DB connector is missing a query');

  if (dbType === 'mysql') {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection(connectionString);
    try {
      const [rows] = await conn.execute(query);
      return rows;
    } finally {
      await conn.end();
    }
  }

  // Default: PostgreSQL
  const { Client } = require('pg');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(query);
    return result.rows;
  } finally {
    await client.end();
  }
}

function parseFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv' || mimeType === 'text/csv') return parseCSV(filePath);
  if (['.xlsx', '.xls', '.ods'].includes(ext)) return parseExcel(filePath);
  throw new Error('Unsupported file type');
}

module.exports = { parseFile, fetchAPI, queryDB };
