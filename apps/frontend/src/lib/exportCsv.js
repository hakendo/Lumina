import api from './api';
import { CACHE } from './datasetCache';

// Escapado CSV (RFC 4180): comillas si el valor lleva coma, comillas o saltos.
// Objetos anidados se serializan a JSON (igual que los muestra TableWidget).
function esc(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows) {
  // Unión de columnas en orden de aparición: filas de API pueden variar de forma
  const cols = [];
  for (const r of rows) {
    for (const k of Object.keys(r || {})) if (!cols.includes(k)) cols.push(k);
  }
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r?.[c])).join(','));
  // BOM para que Excel detecte UTF-8 (acentos/ñ)
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  URL.revokeObjectURL(url);
}

// Mismo caché que usan los widgets: si el reporte ya pintó, no re-descarga
export async function getDatasetRows(datasetId) {
  if (!CACHE[datasetId]) {
    const { data } = await api.get(`/datasets/${datasetId}/rows`);
    CACHE[datasetId] = data;
  }
  return CACHE[datasetId];
}

/**
 * Descarga la data de un reporte: un CSV por dataset usado por sus widgets.
 * `filterFn(rows, datasetId)` permite aplicar los filtros activos del reporte.
 */
export async function exportReportCsv(title, widgets, filterFn = (rows) => rows) {
  const seen = new Set();
  for (const w of widgets) {
    if (!w.datasetId || seen.has(w.datasetId)) continue;
    seen.add(w.datasetId);
    const rows = await getDatasetRows(w.datasetId);
    const filtered = filterFn(rows, w.datasetId);
    const dsName = w.dataset?.name || 'datos';
    downloadCsv(`${title} - ${dsName}.csv`, rowsToCsv(filtered));
    // Pausa breve: varios .click() seguidos hacen que el navegador descarte descargas
    if (seen.size > 1) await new Promise((ok) => setTimeout(ok, 350));
  }
  return seen.size;
}
