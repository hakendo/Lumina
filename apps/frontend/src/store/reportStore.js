import { create } from 'zustand';
import api from '../lib/api';

function syncActive(pages, activeId) {
  const page = pages.find((p) => p.id === activeId) ?? pages[0];
  return {
    activePage: page?.id ?? null,
    widgets: page?.widgets ?? [],
    layout: page?.layout ?? [],
    filters: page?.filters ?? [],
  };
}

export const useReportStore = create((set, get) => ({
  report: null,
  pages: [],
  activePage: null,
  widgets: [],     // shortcut → active page's widgets
  layout: [],      // shortcut → active page's layout
  filters: [],     // shortcut → active page's filters
  filterValues: {},
  // Cross-filter: { [datasetId]: { field, value } } — runtime only, not saved
  crossFilters: {},
  isDirty: false,

  setReport: (report) => {
    const pages = report.pages?.length
      ? report.pages
      : [{
          id: 'p0',
          title: 'Página 1',
          order: 0,
          layout: report.layout ?? [],
          filters: report.filters ?? [],
          widgets: report.widgets ?? [],
        }];
    const first = pages[0];
    set({
      report,
      pages,
      activePage: first.id,
      widgets: first.widgets ?? [],
      layout: first.layout ?? [],
      filters: first.filters ?? [],
      filterValues: {},
      isDirty: false,
    });
  },

  patchReport: (patch) => set((s) => ({ report: { ...s.report, ...patch } })),

  // ── Páginas ──────────────────────────────────────────────────────────────

  setActivePage: (pageId) => set((s) => ({ ...syncActive(s.pages, pageId), crossFilters: {} })),

  addPage: async (reportId) => {
    const title = `Página ${get().pages.length + 1}`;
    const { data: page } = await api.post(`/reports/${reportId}/pages`, { title });
    const newPage = { ...page, widgets: [], layout: [], filters: page.filters ?? [] };
    set((s) => ({
      pages: [...s.pages, newPage],
      ...syncActive([...s.pages, newPage], page.id),
    }));
  },

  removePage: async (reportId, pageId) => {
    if (get().pages.length <= 1) return;
    await api.delete(`/reports/${reportId}/pages/${pageId}`);
    set((s) => {
      const newPages = s.pages.filter((p) => p.id !== pageId);
      const newActiveId = s.activePage === pageId ? newPages[0]?.id : s.activePage;
      return { pages: newPages, ...syncActive(newPages, newActiveId), filterValues: {} };
    });
  },

  renamePage: (pageId, title) => {
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, title } : p)),
      isDirty: true,
    }));
    // Immediately persist to DB for real pages (virtual p0 has no DB row yet)
    if (pageId !== 'p0') {
      const { report } = get();
      api.patch(`/reports/${report.id}/pages/${pageId}`, { title }).catch(() => {
        // Local state still updated; will persist on next full save
      });
    }
  },

  // ── Layout ───────────────────────────────────────────────────────────────

  updateLayout: (layout) => set((s) => ({
    layout,
    pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, layout } : p)),
    isDirty: true,
  })),

  // ── Widgets ──────────────────────────────────────────────────────────────

  addWidget: (widget) => set((s) => {
    const newLayout = [
      ...s.layout,
      { i: widget.id, x: 0, y: s.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0), w: 6, h: 4 },
    ];
    const newWidgets = [...s.widgets, widget];
    return {
      widgets: newWidgets,
      layout: newLayout,
      pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, widgets: newWidgets, layout: newLayout } : p)),
      isDirty: true,
    };
  }),

  removeWidget: (id) => set((s) => {
    const newWidgets = s.widgets.filter((w) => w.id !== id);
    const newLayout = s.layout.filter((l) => l.i !== id);
    return {
      widgets: newWidgets,
      layout: newLayout,
      pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, widgets: newWidgets, layout: newLayout } : p)),
      isDirty: true,
    };
  }),

  updateWidget: (id, patch) => set((s) => {
    const newWidgets = s.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w));
    return {
      widgets: newWidgets,
      pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, widgets: newWidgets } : p)),
      isDirty: true,
    };
  }),

  // ── Filters ───────────────────────────────────────────────────────────────

  addFilter: (filter) => set((s) => {
    const newFilters = [...s.filters, filter];
    return {
      filters: newFilters,
      pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, filters: newFilters } : p)),
      isDirty: true,
    };
  }),

  removeFilter: (id) => set((s) => {
    const rest = { ...s.filterValues };
    delete rest[id];
    const newFilters = s.filters.filter((f) => f.id !== id);
    return {
      filters: newFilters,
      filterValues: rest,
      pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, filters: newFilters } : p)),
      isDirty: true,
    };
  }),

  updateFilter: (id, patch) => set((s) => {
    const newFilters = s.filters.map((f) => (f.id === id ? { ...f, ...patch } : f));
    return {
      filters: newFilters,
      pages: s.pages.map((p) => (p.id === s.activePage ? { ...p, filters: newFilters } : p)),
      isDirty: true,
    };
  }),

  setFilterValue: (id, value) =>
    set((s) => ({ filterValues: { ...s.filterValues, [id]: value } })),

  // Cross-filtering: click en widget emite { datasetId, field, value }
  // Un segundo click en el mismo valor lo limpia (toggle).
  setCrossFilter: (datasetId, field, value) =>
    set((s) => {
      const cur = s.crossFilters[datasetId];
      const same = cur?.field === field && String(cur?.value) === String(value);
      const next = same
        ? (() => { const c = { ...s.crossFilters }; delete c[datasetId]; return c; })()
        : { ...s.crossFilters, [datasetId]: { field, value } };
      return { crossFilters: next };
    }),

  clearCrossFilters: () => set({ crossFilters: {} }),

  // ── Save ─────────────────────────────────────────────────────────────────

  save: async () => {
    const { report, pages } = get();
    const currentActiveId = get().activePage;
    const { data } = await api.put(`/reports/${report.id}`, {
      pages: pages.map((p, i) => ({
        id: p.id,
        title: p.title,
        order: i,
        layout: p.layout,
        filters: p.filters ?? [],
        widgets: p.widgets,
      })),
    });
    const newPages = data.pages?.length ? data.pages : pages;
    const activePg = newPages.find((p) => p.id === currentActiveId) ?? newPages[0];
    set({
      report: data,
      pages: newPages,
      activePage: activePg.id,
      widgets: activePg.widgets ?? [],
      layout: activePg.layout ?? [],
      filters: activePg.filters ?? [],
      isDirty: false,
    });
    return data;
  },
}));

export function applyFilters(rows, datasetId, filters, filterValues, crossFilters) {
  // Cross-filter (runtime click selection)
  const cf = crossFilters?.[datasetId];
  if (cf) {
    rows = rows.filter((row) => String(row[cf.field] ?? '') === String(cf.value));
  }
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
