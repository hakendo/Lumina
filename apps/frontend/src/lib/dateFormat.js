// Cosmetic date/datetime re-formatting for widget display only — never
// touches the underlying dataset or row data, no new dataset is created.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function looksLikeDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

const pad = (n) => String(n).padStart(2, '0');

// pattern tokens: YYYY, MM, DD, HH, mm, ss (e.g. "DD/MM/YYYY HH:mm")
export function formatDateValue(value, pattern) {
  if (!pattern || !looksLikeDate(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const tokens = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => tokens[m]);
}
