const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const { decrypt } = require('./encryption');

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

async function queryDB(storedConfig) {
  const config = resolveConfig(storedConfig);
  const { dbType, connectionString, query } = config;

  if (!connectionString) throw new Error('DB connector is missing a connection string');
  if (!query) throw new Error('DB connector is missing a query');

  validateSelectQuery(query);

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

async function parseFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv' || mimeType === 'text/csv') return parseCSV(filePath);
  if (['.xlsx', '.xls', '.ods'].includes(ext)) return parseExcel(filePath);
  throw new Error('Unsupported file type');
}

module.exports = { parseFile, fetchAPI, queryDB };
