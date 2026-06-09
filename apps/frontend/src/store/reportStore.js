import { create } from 'zustand';
import api from '../lib/api';

export const useReportStore = create((set, get) => ({
  report: null,
  widgets: [],
  layout: [],
  filters: [],       // filter definitions — persisted with report
  filterValues: {},  // { [filterId]: value } — runtime only, not saved
  isDirty: false,

  setReport: (report) =>
    set({
      report,
      widgets: report.widgets || [],
      layout: report.layout || [],
      filters: report.filters || [],
      filterValues: {},
      isDirty: false,
    }),

  updateLayout: (layout) => set({ layout, isDirty: true }),

  // ── Widgets ──────────────────────────────────────────────────────────────
  addWidget: (widget) =>
    set((s) => ({
      widgets: [...s.widgets, widget],
      layout: [...s.layout, { i: widget.id, x: 0, y: Infinity, w: 6, h: 4 }],
      isDirty: true,
    })),

  removeWidget: (id) =>
    set((s) => ({
      widgets: s.widgets.filter((w) => w.id !== id),
      layout: s.layout.filter((l) => l.i !== id),
      isDirty: true,
    })),

  updateWidget: (id, patch) =>
    set((s) => ({
      widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      isDirty: true,
    })),

  // ── Filters ───────────────────────────────────────────────────────────────
  addFilter: (filter) => set((s) => ({ filters: [...s.filters, filter], isDirty: true })),

  removeFilter: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.filterValues;
      return { filters: s.filters.filter((f) => f.id !== id), filterValues: rest, isDirty: true };
    }),

  updateFilter: (id, patch) =>
    set((s) => ({
      filters: s.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      isDirty: true,
    })),

  setFilterValue: (id, value) =>
    set((s) => ({ filterValues: { ...s.filterValues, [id]: value } })),

  // ── Save ─────────────────────────────────────────────────────────────────
  save: async () => {
    const { report, widgets, layout, filters } = get();
    const { data } = await api.put(`/reports/${report.id}`, { layout, filters, widgets });
    set({ report: data, isDirty: false });
    return data;
  },
}));

// Helper used by WidgetRenderer to apply active filters to a dataset's rows
export function applyFilters(rows, datasetId, filters, filterValues) {
  if (!filters?.length) return rows;
  let result = rows;
  for (const f of filters) {
    if (f.datasetId !== datasetId) continue;
    const val = filterValues[f.id];
    if (val === null || val === undefined || val === '') continue;

    if (f.type === 'select') {
      result = result.filter((row) => String(row[f.field] ?? '') === String(val));
    } else if (f.type === 'range') {
      const [min, max] = val;
      result = result.filter((row) => {
        const n = Number(row[f.field]);
        return !isNaN(n) && (min === '' || n >= Number(min)) && (max === '' || n <= Number(max));
      });
    } else if (f.type === 'daterange') {
      const [from, to] = val;
      result = result.filter((row) => {
        const d = new Date(row[f.field]);
        if (isNaN(d)) return true;
        return (!from || d >= new Date(from)) && (!to || d <= new Date(to));
      });
    }
  }
  return result;
}
