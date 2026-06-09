const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

async function fetchAPI(config) {
  const { url, method = 'GET', headers = {}, body, dataPath } = config;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const json = await res.json();
  if (dataPath) {
    return dataPath.split('.').reduce((obj, key) => obj?.[key], json) ?? [];
  }
  return Array.isArray(json) ? json : [json];
}

function parseFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv' || mimeType === 'text/csv') return parseCSV(filePath);
  if (['.xlsx', '.xls', '.ods'].includes(ext)) return parseExcel(filePath);
  throw new Error('Unsupported file type');
}

module.exports = { parseFile, fetchAPI };
