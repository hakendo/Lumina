const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { decrypt } = require('./encryption');

// ── Connection pool manager ─────────────────────────────────────────
const POOL_TTL = 10 * 60 * 1000;
const pools = new Map();

function poolKey(dbType, connectionString) {
  return dbType + ':' + crypto.createHash('md5').update(connectionString).digest('hex');
}

function cleanupPools() {
  const now = Date.now();
  for (const [key, entry] of pools) {
    if (now - entry.lastUsed > POOL_TTL) {
      entry.close().catch(() => {});
      pools.delete(key);
    }
  }
}

setInterval(cleanupPools, 60_000).unref();

async function getPooledPg(connectionString) {
  const key = poolKey('pg', connectionString);
  if (pools.has(key)) {
    const entry = pools.get(key);
    entry.lastUsed = Date.now();
    return entry.pool;
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: POOL_TTL });
  pools.set(key, { pool, lastUsed: Date.now(), close: () => pool.end() });
  return pool;
}

async function getPooledMysql(connectionString) {
  const key = poolKey('mysql', connectionString);
  if (pools.has(key)) {
    const entry = pools.get(key);
    entry.lastUsed = Date.now();
    return entry.pool;
  }
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({ uri: connectionString, connectionLimit: 3, idleTimeout: POOL_TTL });
  pools.set(key, { pool, lastUsed: Date.now(), close: () => pool.end() });
  return pool;
}

async function getPooledMssql(connectionString) {
  const key = poolKey('mssql', connectionString);
  if (pools.has(key)) {
    const entry = pools.get(key);
    entry.lastUsed = Date.now();
    return entry.pool;
  }
  const sql = require('mssql');
  const pool = await sql.connect(connectionString);
  pools.set(key, { pool, lastUsed: Date.now(), close: () => pool.close() });
  return pool;
}
// ─────────────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

async function parseExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  let headers = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      headers = row.values.slice(1).map((v) => String(v ?? ''));
    } else {
      const obj = {};
      row.values.slice(1).forEach((v, i) => {
        obj[headers[i] ?? i] = v instanceof Date ? v.toISOString() : (v ?? null);
      });
      rows.push(obj);
    }
  });
  return rows;
}

function resolveConfig(storedConfig) {
  if (!storedConfig._enc) return storedConfig;
  const sensitive = decrypt(storedConfig._enc);
  const { _enc, ...pub } = storedConfig;
  return { ...pub, ...sensitive };
}

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

function normalizeRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return { value: row };
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return out;
}

// SEC-002: block private / loopback / link-local IPs (SSRF prevention)
const PRIVATE_IP_RE = [
  /^127\./,
  /^0\./,
  /^::1$/,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

async function assertPublicHost(urlStr) {
  const parsed = new URL(urlStr);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Protocolo no permitido'), { errorType: 'connection_error' });
  }
  let address;
  try {
    ({ address } = await dns.lookup(parsed.hostname));
  } catch {
    throw Object.assign(
      new Error(`No se pudo resolver el host: ${parsed.hostname}`),
      { errorType: 'connection_error' }
    );
  }
  if (PRIVATE_IP_RE.some((re) => re.test(address))) {
    throw Object.assign(
      new Error('No se permite conectar a redes internas o privadas'),
      { errorType: 'connection_error' }
    );
  }
}

const SSL_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_UNTRUSTED',
]);

function isSslError(err) {
  return SSL_ERROR_CODES.has(err.code) || SSL_ERROR_CODES.has(err.cause?.code);
}

function httpRequest(finalUrl, { method, headers, body, allowInsecureSsl }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(finalUrl);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      ...(isHttps && { rejectUnauthorized: !allowInsecureSsl }),
    };
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          text: () => data,
          json: () => JSON.parse(data),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchAPI(storedConfig) {
  const config = resolveConfig(storedConfig);
  const { url, method = 'GET', headers = {}, queryParams = {}, body, dataPath, allowInsecureSsl } = config;

  if (!url) throw new Error('API connector is missing a URL');

  let finalUrl = url;
  if (queryParams && Object.keys(queryParams).length) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(queryParams)) u.searchParams.set(k, String(v));
    finalUrl = u.toString();
  }

  // SEC-002: block SSRF before making the request
  await assertPublicHost(finalUrl);

  let res;
  try {
    res = await httpRequest(finalUrl, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : null,
      allowInsecureSsl: !!allowInsecureSsl,
    });
  } catch (err) {
    if (err.errorType) throw err;
    if (isSslError(err)) {
      const sslErr = new Error(
        `Error de certificado SSL (${err.code || err.cause?.code}). ` +
        'Activa "Ignorar SSL" en la configuración si el servidor usa un certificado auto-firmado.'
      );
      sslErr.errorType = 'ssl_error';
      throw sslErr;
    }
    const connErr = new Error(`No se pudo conectar a la API: ${err.message}`);
    connErr.errorType = 'connection_error';
    throw connErr;
  }

  if (!res.ok) {
    const text = res.text();
    const detail = text ? ` — ${text.slice(0, 500)}` : '';
    const httpErr = new Error(`API respondió ${res.status} ${res.statusText}${detail}`);
    httpErr.errorType = 'http_error';
    throw httpErr;
  }

  let json;
  try { json = res.json(); } catch {
    const parseErr = new Error('La API no devolvió JSON válido');
    parseErr.errorType = 'parse_error';
    throw parseErr;
  }

  return extractRows(json, dataPath).map(normalizeRow);
}

// SEC-008: only allow SELECT queries against external DBs
function validateSelectQuery(query) {
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();
  if (!/^select[\s(]/i.test(stripped)) {
    throw Object.assign(
      new Error('Solo se permiten consultas SELECT en conectores de base de datos'),
      { errorType: 'connection_error' }
    );
  }
}

// Normalizes a Redis reply into [{key, value}] rows or keeps existing structure
function normalizeRedisReply(command, reply) {
  if (Array.isArray(reply)) {
    // LRANGE / SMEMBERS — array of scalars
    if (typeof reply[0] !== 'object') return reply.map((v, i) => ({ index: i, value: v }));
    // Arrays of arrays (HGETALL as array of [field, value] pairs from some modes)
    return reply.map((v, i) => (Array.isArray(v) ? { index: i, value: v.join(',') } : v));
  }
  if (reply !== null && typeof reply === 'object') {
    // HGETALL returns plain object
    return Object.entries(reply).map(([field, value]) => ({ field, value }));
  }
  // Scalar reply (GET, SET, etc.)
  return [{ value: reply }];
}

async function queryDB(storedConfig) {
  const config = resolveConfig(storedConfig);
  const { dbType = 'pg', connectionString, query } = config;

  if (!connectionString) throw new Error('DB connector is missing a connection string');
  if (!query?.trim()) throw new Error('DB connector is missing a query or command');

  // ── Redis ───────────────────────────────────────────────────────────
  if (dbType === 'redis') {
    const Redis = require('ioredis');
    const client = new Redis(connectionString, { lazyConnect: true, connectTimeout: 10000 });
    await client.connect();
    try {
      // Parse "COMMAND arg1 arg2 …" into array for ioredis.call()
      const [cmd, ...args] = query.trim().split(/\s+/);
      // Only allow read-only commands
      const RO_COMMANDS = new Set([
        'get','mget','hget','hmget','hgetall','hkeys','hvals','hlen',
        'lrange','llen','lindex','smembers','scard','sismember','sscan',
        'zrange','zrangebyscore','zrangebylex','zcard','zscore','zscan',
        'keys','scan','type','ttl','pttl','exists','strlen','getrange',
        'lolwut','dbsize','info','client',
      ]);
      if (!RO_COMMANDS.has(cmd.toLowerCase())) {
        throw Object.assign(
          new Error(`Comando Redis no permitido: ${cmd}. Solo se aceptan comandos de lectura.`),
          { errorType: 'connection_error' }
        );
      }
      const result = await client.call(cmd, ...args);
      return normalizeRedisReply(cmd, result);
    } finally {
      await client.quit();
    }
  }

  validateSelectQuery(query);

  // ── MySQL (pooled) ──────────────────────────────────────────────────
  if (dbType === 'mysql') {
    const pool = await getPooledMysql(connectionString);
    const [rows] = await pool.execute(query);
    return rows;
  }

  // ── SQL Server (pooled) ────────────────────────────────────────────
  if (dbType === 'mssql') {
    const pool = await getPooledMssql(connectionString);
    const result = await pool.request().query(query);
    return result.recordset;
  }

  // ── Oracle (ephemeral — no built-in pool manager) ──────────────────
  if (dbType === 'oracle') {
    const oracledb = require('oracledb');
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    const conn = await oracledb.getConnection(connectionString);
    try {
      const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return result.rows ?? [];
    } finally {
      await conn.close();
    }
  }

  // ── PostgreSQL (pooled, default) ───────────────────────────────────
  const pool = await getPooledPg(connectionString);
  const result = await pool.query(query);
  return result.rows;
}

async function parseFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv' || mimeType === 'text/csv') return parseCSV(filePath);
  if (['.xlsx', '.xls', '.ods'].includes(ext)) return parseExcel(filePath);
  throw new Error('Unsupported file type');
}

module.exports = { parseFile, fetchAPI, queryDB, getPooledPg, getPooledMysql, getPooledMssql, resolveConfig, poolKey };
