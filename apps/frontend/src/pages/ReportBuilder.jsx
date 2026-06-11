import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import { nanoid } from 'nanoid';
import api from '../lib/api';
import { useReportStore } from '../store/reportStore';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';
import WidgetConfigPanel from '../components/Canvas/WidgetConfigPanel';
import FilterBar from '../components/Canvas/FilterBar';
import ShareModal from '../components/ShareModal';
import { Icon, ReportSkeleton, Wordmark } from '../components/ui';

const WIDGET_TYPES = [
  { type: 'chart', label: 'Gráfico', icon: 'chart' },
  { type: 'kpi', label: 'KPI', icon: 'hash' },
  { type: 'table', label: 'Tabla', icon: 'table' },
  { type: 'pivot', label: 'Pivot', icon: 'grid' },
  { type: 'map', label: 'Mapa', icon: 'pin' },
];

export default function ReportBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { report, widgets, layout, isDirty, setReport, patchReport, updateLayout, addWidget, save } = useReportStore();
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });

  useEffect(() => {
    api.get(`/reports/${id}`).then(({ data }) => {
      // Sin permiso de edición → vista de solo lectura
      if (!['owner', 'editor'].includes(data.myRole)) {
        navigate(`/report/${id}/view`, { replace: true });
        return;
      }
      setReport(data);
    });
    return () => setSelectedWidget(null);
  }, [id]);

  // Aviso al cerrar la pestaña con cambios sin guardar
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const handleSave = async () => {
    setSaving(true);
    try { await save(); } finally { setSaving(false); }
  };

  // Ctrl/Cmd+S guarda
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDirty, saving]);

  const addNewWidget = (type) => {
    addWidget({ id: nanoid(), widgetType: type, config: {}, datasetId: null });
  };

  const exportPDF = async () => {
    const res = await api.get(`/reports/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${report?.title}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!report) {
    return (
      <div className="min-h-screen paper-bg flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4"><Wordmark size="text-base" /></div>
        <ReportSkeleton />
      </div>
    );
  }

  const activeWidget = selectedWidget ? widgets.find((w) => w.id === selectedWidget) : null;

  return (
    <div className="h-screen bg-paper flex flex-col" data-report-ready>
      {/* Header */}
      <header className="bg-surface border-b border-line px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
        <Link to="/" title="Volver al dashboard"
          className="inline-flex items-center gap-1.5 text-ink-soft hover:text-ink text-sm transition">
          <Icon name="arrowLeft" size={15} />
        </Link>
        <span className="text-line hidden sm:inline">|</span>
        <h1 className="font-display text-sm text-ink flex-1 truncate min-w-[120px]">{report.title}</h1>

        {isDirty && (
          <span className="text-xs text-lumen-deep bg-lumen-soft px-2 py-0.5 rounded-full shrink-0 font-mono">
            sin guardar
          </span>
        )}
        {report.isPublic && (
          <span className="text-xs bg-sea-soft text-sea px-2 py-0.5 rounded-full shrink-0">Público</span>
        )}

        <button onClick={() => setShareOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer">
          <Icon name="link" size={13} /> Compartir
        </button>

        <Link to={`/report/${id}/view`} title="Vista previa"
          className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0">
          <Icon name="eye" size={13} /> <span className="hidden sm:inline">Vista previa</span>
        </Link>

        <button onClick={exportPDF}
          className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer">
          <Icon name="download" size={13} /> PDF
        </button>

        <button onClick={handleSave} disabled={saving || !isDirty} title="Ctrl+S"
          className="text-xs bg-ink text-paper hover:bg-ink/85 px-3.5 py-1.5 rounded-lg transition disabled:opacity-40 font-medium shrink-0 cursor-pointer">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </header>

      {/* Barra de filtros */}
      <FilterBar />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Paleta de widgets: columna en desktop, fila scrolleable en mobile */}
        <aside className="bg-surface border-b md:border-b-0 md:border-r border-line p-2 md:p-3 flex md:flex-col md:w-44 gap-1 shrink-0 overflow-x-auto md:overflow-visible">
          <p className="hidden md:block text-[11px] font-semibold text-ink-faint uppercase tracking-widest mb-1.5 px-1">
            Widgets
          </p>
          {WIDGET_TYPES.map(({ type, label, icon }) => (
            <button key={type} onClick={() => addNewWidget(type)}
              className="flex items-center gap-2 md:gap-2.5 text-sm text-ink-soft hover:bg-lumen-soft hover:text-lumen-deep rounded-lg px-3 py-2 transition text-left whitespace-nowrap md:w-full cursor-pointer">
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </aside>

        {/* Canvas */}
        <main ref={containerRef} className="flex-1 overflow-auto p-4 canvas-bg" id="canvas-container"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedWidget(null); }}>
          {widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 pointer-events-none">
              <div className="w-14 h-14 rounded-2xl bg-surface border border-line grid place-items-center text-lumen-deep shadow-card">
                <Icon name="chart" size={24} strokeWidth={1.6} />
              </div>
              <p className="text-sm text-ink-faint text-center px-6">Agrega widgets desde la paleta</p>
            </div>
          ) : (
            <GridLayout
              layout={layout}
              gridConfig={{ cols: 12, rowHeight: 50 }}
              dragConfig={{ handle: '.drag-handle' }}
              width={Math.max(width - 32, 320)}
              onLayoutChange={updateLayout}
              style={{ minHeight: 400 }}
            >
              {widgets.map((w) => (
                <div key={w.id}
                  className={`bg-surface border rounded-xl overflow-hidden flex flex-col cursor-default shadow-card transition-colors ${
                    selectedWidget === w.id
                      ? 'border-lumen ring-2 ring-lumen-glow/30'
                      : 'border-line-soft hover:border-line'
                  }`}
                  onClick={(e) => { e.stopPropagation(); setSelectedWidget(w.id); }}
                >
                  <div className="drag-handle h-7 bg-paper border-b border-line-soft flex items-center gap-2 px-2 cursor-grab active:cursor-grabbing shrink-0">
                    <span className="text-ink-faint/60 select-none leading-none tracking-tighter text-[10px]">⠿⠿</span>
                    <span className="font-mono text-[11px] text-ink-faint flex-1 truncate select-none">
                      {w.config?.title || w.widgetType}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedWidget(w.id); }}
                      title="Configurar"
                      className="text-ink-faint hover:text-lumen-deep px-1 cursor-pointer">
                      <Icon name="sliders" size={12} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden p-2 min-h-0">
                    <WidgetRenderer widget={w} />
                  </div>
                </div>
              ))}
            </GridLayout>
          )}
        </main>

        {/* Panel de configuración: overlay en mobile, columna en desktop */}
        {activeWidget && (
          <WidgetConfigPanel
            key={activeWidget.id}
            widget={activeWidget}
            onClose={() => setSelectedWidget(null)}
          />
        )}
      </div>

      {shareOpen && (
        <ShareModal report={report} onChange={patchReport} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
