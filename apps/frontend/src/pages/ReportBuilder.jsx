import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { GridLayout, useContainerWidth } from 'react-grid-layout';
import { nanoid } from 'nanoid';
import api from '../lib/api';
import { exportReportCsv } from '../lib/exportCsv';
import { useReportStore, applyFilters } from '../store/reportStore';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';
import WidgetConfigPanel from '../components/Canvas/WidgetConfigPanel';
import FilterBar from '../components/Canvas/FilterBar';
import ShareModal from '../components/ShareModal';
import { Icon, Modal, ReportSkeleton, Wordmark } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const WIDGET_TYPES = [
  { type: 'chart', label: 'Gráfico', icon: 'chart' },
  { type: 'kpi', label: 'KPI', icon: 'hash' },
  { type: 'table', label: 'Tabla', icon: 'table' },
  { type: 'pivot', label: 'Pivot', icon: 'grid' },
  { type: 'map', label: 'Mapa', icon: 'pin' },
];

// Custom resize handle rendered inside each grid item.
// Must be a forwardRef component — react-grid-layout passes a ref to it.
const ResizeHandle = React.forwardRef(function ResizeHandle({ handleAxis, ...rest }, ref) {
  return (
    <div ref={ref} {...rest}
      className="react-resizable-handle react-resizable-handle-se"
      style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 18, height: 18,
        cursor: 'se-resize',
        zIndex: 20,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
        padding: '3px',
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M9 1L1 9M9 5L5 9M9 9H5" stroke="rgba(150,141,123,0.6)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
});

// ── Tabs de páginas ───────────────────────────────────────────────

function PageTabs({ reportId }) {
  const { pages, activePage, setActivePage, addPage, removePage, renamePage } = useReportStore();
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const inputRef = useRef(null);

  const startRename = (page) => {
    setRenamingId(page.id);
    setRenameVal(page.title);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (renamingId && renameVal.trim()) renamePage(renamingId, renameVal.trim());
    setRenamingId(null);
  };

  const handleAdd = () => addPage(reportId);

  const handleRemove = async (e, pageId) => {
    e.stopPropagation();
    await removePage(reportId, pageId);
  };

  return (
    <div className="bg-surface border-b border-line flex items-center overflow-x-auto shrink-0 px-1 gap-0.5">
      {pages.map((page) => {
        const isActive = page.id === activePage;
        return (
          <div key={page.id} className={`flex items-center gap-0.5 border-b-2 transition shrink-0 ${
            isActive ? 'border-lumen-deep' : 'border-transparent'
          }`}>
            {renamingId === page.id ? (
              <input
                ref={inputRef}
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="text-xs px-2 py-2 bg-transparent outline-none border-none w-28 font-medium text-lumen-deep"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setActivePage(page.id)}
                onDoubleClick={() => startRename(page)}
                title="Doble clic para renombrar"
                className={`text-xs px-3 py-2.5 font-medium transition whitespace-nowrap ${
                  isActive ? 'text-lumen-deep' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {page.title}
              </button>
            )}
            {pages.length > 1 && (
              <button
                onClick={(e) => handleRemove(e, page.id)}
                className="text-ink-faint hover:text-rust transition cursor-pointer pr-1.5"
                title="Eliminar página"
              >
                <Icon name="x" size={10} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={handleAdd}
        className="text-ink-faint hover:text-ink transition px-2 py-2 cursor-pointer shrink-0"
        title="Nueva página"
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

// ── Builder principal ─────────────────────────────────────────────

export default function ReportBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    report, widgets, layout, isDirty,
    setReport, patchReport, updateLayout, addWidget, save,
    crossFilters, clearCrossFilters,
    drillFilters, drillStack, drillBack, pages,
  } = useReportStore();
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [fullscreenWidget, setFullscreenWidget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const descInputRef = useRef(null);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });

  useEffect(() => {
    api.get(`/reports/${id}`).then(({ data }) => {
      if (!['owner', 'editor'].includes(data.myRole)) {
        navigate(`/report/${id}/view`, { replace: true });
        return;
      }
      setReport(data);
    });
    return () => setSelectedWidget(null);
  }, [id]);

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

  // Notifica a los gráficos ECharts que el contenedor cambió de tamaño
  const handleLayoutChange = (newLayout) => {
    updateLayout(newLayout);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
  };

  const exportPDF = async () => {
    const res = await api.get(`/reports/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${report?.title}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const { filters, filterValues } = useReportStore.getState();
    exportReportCsv(report.title, widgets, (rows, dsId) =>
      applyFilters(rows, dsId, filters, filterValues)
    );
  };

  const startEditTitle = () => {
    setTitleDraft(report.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const commitTitle = useCallback(async () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (!next || next === report.title) return;
    patchReport({ title: next });
    await api.patch(`/reports/${id}`, { title: next });
  }, [titleDraft, report?.title, id]);

  const startEditDesc = () => {
    setDescDraft(report.description ?? '');
    setEditingDesc(true);
    setTimeout(() => descInputRef.current?.focus(), 0);
  };

  const commitDesc = useCallback(async () => {
    setEditingDesc(false);
    const next = descDraft.trim();
    if (next === (report.description ?? '')) return;
    patchReport({ description: next || null });
    await api.patch(`/reports/${id}`, { description: next || null });
  }, [descDraft, report?.description, id]);

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
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            className="font-display text-sm text-ink flex-1 min-w-[120px] bg-paper border border-lumen rounded-lg px-2 py-0.5 outline-none"
          />
        ) : (
          <h1
            className="font-display text-sm text-ink flex-1 truncate min-w-[120px] cursor-text hover:text-lumen-deep transition"
            onDoubleClick={startEditTitle}
            title="Doble clic para renombrar"
          >
            {report.title}
          </h1>
        )}

        {isDirty && (
          <span className="text-xs text-lumen-deep bg-lumen-soft px-2 py-0.5 rounded-full shrink-0 font-mono">
            sin guardar
          </span>
        )}
        {report.isPublic && (
          <span className="text-xs bg-sea-soft text-sea px-2 py-0.5 rounded-full shrink-0">Público</span>
        )}
        {report.isTemplate && (
          <span className="text-xs bg-lumen-soft text-lumen-deep px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
            <Icon name="copy" size={11} /> Plantilla
          </span>
        )}
        {user?.role === 'superadmin' && !report.isTemplate && (
          <button
            onClick={async () => {
              patchReport({ isTemplate: true });
              await api.patch(`/reports/${id}`, { isTemplate: true });
            }}
            className="text-xs text-ink-faint hover:text-lumen-deep transition cursor-pointer shrink-0"
            title="Marcar como plantilla base">
            + Plantilla
          </button>
        )}
        {user?.role === 'superadmin' && report.isTemplate && (
          <button
            onClick={async () => {
              patchReport({ isTemplate: false });
              await api.patch(`/reports/${id}`, { isTemplate: false });
            }}
            className="text-xs text-ink-faint hover:text-rust transition cursor-pointer shrink-0"
            title="Quitar plantilla base">
            Quitar plantilla
          </button>
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

        <button onClick={exportCSV} title="Descargar datos (un CSV por dataset, con filtros aplicados)"
          className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer">
          <Icon name="download" size={13} /> CSV
        </button>

        <button onClick={handleSave} disabled={saving || !isDirty} title="Ctrl+S"
          className="text-xs bg-ink text-paper hover:bg-ink/85 px-3.5 py-1.5 rounded-lg transition disabled:opacity-40 font-medium shrink-0 cursor-pointer">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </header>

      {/* Descripción inline editable */}
      <div className="bg-surface border-b border-line-soft px-4 sm:px-6 py-1.5 shrink-0">
        {editingDesc ? (
          <input
            ref={descInputRef}
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDesc(); if (e.key === 'Escape') setEditingDesc(false); }}
            placeholder="Descripción del reporte…"
            className="w-full text-xs text-ink-soft bg-transparent outline-none border-none"
          />
        ) : report.description ? (
          <button onClick={startEditDesc}
            className="text-xs text-ink-faint hover:text-ink-soft transition text-left w-full truncate cursor-text">
            {report.description}
          </button>
        ) : (
          <button onClick={startEditDesc}
            className="text-xs text-ink-faint/40 hover:text-ink-faint transition cursor-text">
            + Añadir descripción
          </button>
        )}
      </div>

      {/* Barra de filtros */}
      <FilterBar />

      {/* Breadcrumb de drill-through */}
      {drillStack.length > 0 && (
        <div className="bg-sea-soft border-b border-sea/20 px-4 py-1.5 flex items-center gap-2 shrink-0">
          <Icon name="arrowLeft" size={12} className="text-sea" />
          <span className="text-xs text-sea font-medium">
            Drill-through desde: {pages.find((p) => p.id === drillStack[drillStack.length - 1]?.pageId)?.title ?? '…'}
            {drillFilters.map((df, i) => <span key={i} className="ml-2 opacity-70">· {df.field} = "{df.value}"</span>)}
          </span>
          <button onClick={drillBack} className="text-xs text-sea hover:text-sea/70 transition cursor-pointer ml-auto underline">
            Volver
          </button>
        </div>
      )}

      {/* Indicador de cross-filter activo */}
      {Object.keys(crossFilters).length > 0 && (
        <div className="bg-lumen-soft border-b border-lumen-line px-4 py-1.5 flex items-center gap-2 shrink-0">
          <Icon name="filter" size={12} className="text-lumen-deep" />
          <span className="text-xs text-lumen-deep font-medium">
            Cross-filter activo: {Object.entries(crossFilters).map(([, cf]) => `${cf.field} = "${cf.value}"`).join(' · ')}
          </span>
          <button onClick={clearCrossFilters} className="text-xs text-lumen-deep hover:text-rust transition cursor-pointer ml-auto underline">
            Limpiar
          </button>
        </div>
      )}

      {/* Tabs de páginas */}
      <PageTabs reportId={id} />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Paleta de widgets */}
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
              resizeConfig={{ handles: ['se'], handleComponent: ResizeHandle }}
              width={Math.max(width - 32, 320)}
              onLayoutChange={handleLayoutChange}
              style={{ minHeight: 400 }}
            >
              {widgets.map((w) => (
                <div key={w.id}
                  className={`bg-surface border rounded-xl flex flex-col cursor-default shadow-card transition-colors ${
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
                      onClick={(e) => { e.stopPropagation(); setFullscreenWidget(w); }}
                      title="Vista completa"
                      className="text-ink-faint hover:text-lumen-deep px-1 cursor-pointer">
                      <Icon name="eye" size={12} />
                    </button>
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

        {/* Panel de configuración */}
        {activeWidget && (
          <WidgetConfigPanel
            key={activeWidget.id}
            widget={activeWidget}
            onClose={() => setSelectedWidget(null)}
          />
        )}
      </div>

      {/* Fullscreen widget preview */}
      {fullscreenWidget && (
        <Modal
          title={fullscreenWidget.config?.title || fullscreenWidget.widgetType}
          onClose={() => setFullscreenWidget(null)}
          maxWidth="max-w-5xl"
        >
          <div style={{ height: '65vh' }}>
            <WidgetRenderer widget={fullscreenWidget} />
          </div>
        </Modal>
      )}

      {shareOpen && (
        <ShareModal report={report} onChange={patchReport} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
