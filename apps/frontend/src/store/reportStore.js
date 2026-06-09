import { create } from 'zustand';
import api from '../lib/api';

export const useReportStore = create((set, get) => ({
  report: null,
  widgets: [],
  layout: [],
  isDirty: false,

  setReport: (report) =>
    set({ report, widgets: report.widgets || [], layout: report.layout || [], isDirty: false }),

  updateLayout: (layout) => set({ layout, isDirty: true }),

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

  save: async () => {
    const { report, widgets, layout } = get();
    const { data } = await api.put(`/reports/${report.id}`, { layout, widgets });
    set({ report: data, isDirty: false });
    return data;
  },
}));
