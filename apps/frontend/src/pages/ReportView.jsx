import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { GridLayout, useContainerWidth } from 'react-grid-layout';
import api, { setMemoryToken } from '../lib/api';
import { exportReportCsv } from '../lib/exportCsv';
import { invalidateDatasetCache } from '../lib/datasetCache';
import { useAuthStore } from '../store/authStore';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';
import { Icon, ReportSkeleton, Wordmark } from '../components/ui';
import { useReportStore } from '../store/reportStore';

export default function ReportView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const {
    report, pages, activePage, widgets: pageWidgets, layout: pageLayout,
    setReport, setActivePage,
    crossFilters, clearCrossFilters,
    drillFilters, drillStack, drillBack,
  } = useReportStore();
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });

  const printMode = params.get('print') === '1';
  const tokenParam = params.get('token');
  const pageIdParam = params.get('pageId');
  if (printMode && tokenParam && !localStorage.getItem('token')) {
    setMemoryToken(tokenParam);
  }

  useEffect(() => {
    setError('');
    api.get(`/reports/${id}`)
      .then(({ data }) => {
        setReport(data);
        if (pageIdParam) {
          const resolvedPages = data.pages?.length ? data.pages : [{ id: 'p0' }];
          const target = resolvedPages.find((p) => p.id === pageIdParam);
          if (target) setActivePage(target.id);
        }
      })
      .catch(() => setError('Reporte no encontrado'));
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen paper-bg gap-3">
        <Wordmark />
        <p className="text-ink-faint text-sm">{error}</p>
        <Link to="/" className="text-lumen-deep text-sm font-medium hover:underline">← Volver al dashboard</Link>
      </div>
    );
  }

  if (!report || report.id !== id) {
    return (
      <div className="min-h-screen paper-bg flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4"><Wordmark size="text-base" /></div>
        <ReportSkeleton />
      </div>
    );
  }

  const isOwner = report.myRole === 'owner';
  const canEdit = isOwner || report.myRole === 'editor';

  const refreshData = () => {
    setRefreshing(true);
    for (const p of report.pages || []) {
      for (const w of p.widgets || []) {
        if (w.datasetId) invalidateDatasetCache(w.datasetId);
      }
    }
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  };

  const exportPDF = async () => {
    const res = await api.get(`/reports/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${report.title}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={printMode ? 'min-h-screen bg-paper' : 'min-h-screen paper-bg'} data-report-ready>
      {!printMode && (
        <header className="bg-surface/85 backdrop-blur border-b border-line px-4 py-2.5 flex items-center gap-3 sticky top-0 z-40">
          <Link to="/" title="Volver al dashboard"
            className="inline-flex items-center text-ink-soft hover:text-ink transition">
            <Icon name="arrowLeft" size={15} />
          </Link>
          <span className="text-line">|</span>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-sm text-ink truncate">{report.title}</h1>
            {report.description && <p className="text-xs text-ink-faint truncate">{report.description}</p>}
          </div>
          {report.isPublic && (
            <span className="text-xs bg-sea-soft text-sea px-2 py-0.5 rounded-full shrink-0">Público</span>
          )}
          {(report.areas || []).map((a) => (
            <span key={a.id} className="text-xs bg-lumen-soft text-lumen-deep px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
              <Icon name="layers" size={10} /> {a.name}
            </span>
          ))}
          <button onClick={refreshData} disabled={refreshing} title="Actualizar datos"
            className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer disabled:opacity-50">
            <Icon name="refresh" size={13} className={refreshing ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button onClick={exportPDF}
            className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer">
            <Icon name="download" size={13} /> PDF
          </button>
          <button onClick={() => exportReportCsv(report.title, pageWidgets)}
            title="Descargar datos (un CSV por dataset)"
            className="inline-flex items-center gap-1.5 text-xs bg-paper-deep text-ink-soft hover:bg-line-soft px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer">
            <Icon name="download" size={13} /> CSV
          </button>
          {canEdit && (
            <Link to={`/report/${id}`}
              className="inline-flex items-center gap-1.5 text-xs bg-ink text-paper hover:bg-ink/85 px-3.5 py-1.5 rounded-lg transition font-medium shrink-0">
              <Icon name="pencil" size={13} /> Editar
            </Link>
          )}
        </header>
      )}

      {/* Tabs de páginas */}
      {pages.length > 1 && !printMode && (
        <div className="bg-surface border-b border-line flex items-center overflow-x-auto px-1 gap-0.5">
          {pages.map((page) => (
            <button key={page.id}
              onClick={() => setActivePage(page.id)}
              className={`text-xs px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
                page.id === activePage
                  ? 'border-lumen-deep text-lumen-deep'
                  : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              {page.title}
            </button>
          ))}
        </div>
      )}

      {/* Breadcrumb de drill-through */}
      {drillStack.length > 0 && !printMode && (
        <div className="bg-sea-soft border-b border-sea/20 px-4 py-1.5 flex items-center gap-2">
          <Icon name="arrowLeft" size={12} className="text-sea" />
          <span className="text-xs text-sea font-medium">
            Drill-through desde: {pages.find((p) => p.id === drillStack[drillStack.length - 1]?.pageId)?.title ?? '…'}
            {drillFilters.map((df, i) => (
              <span key={i} className="ml-2 opacity-70">· {df.field} = "{df.value}"</span>
            ))}
          </span>
          <button onClick={drillBack} className="text-xs text-sea hover:text-sea/70 transition cursor-pointer ml-auto underline">
            Volver
          </button>
        </div>
      )}

      {/* Indicador de cross-filter activo */}
      {Object.keys(crossFilters).length > 0 && !printMode && (
        <div className="bg-lumen-soft border-b border-lumen-line px-4 py-1.5 flex items-center gap-2">
          <Icon name="filter" size={12} className="text-lumen-deep" />
          <span className="text-xs text-lumen-deep font-medium">
            {Object.entries(crossFilters).map(([, cf]) => `${cf.field} = "${cf.value}"`).join(' · ')}
          </span>
          <button onClick={clearCrossFilters} className="text-xs text-lumen-deep hover:text-rust transition cursor-pointer ml-auto underline">
            Limpiar
          </button>
        </div>
      )}

      <main ref={containerRef} className="p-4 sm:p-6">
        <GridLayout layout={pageLayout} width={Math.max(width - 32, 320)}
          gridConfig={{ cols: 12, rowHeight: 50 }}
          dragConfig={{ enabled: false }} resizeConfig={{ enabled: false }}>
          {pageWidgets.map((w) => (
            <div key={w.id} className="bg-surface border border-line-soft rounded-xl overflow-hidden flex flex-col shadow-card">
              <div className="flex-1 p-2 overflow-hidden">
                <WidgetRenderer widget={w} refreshKey={refreshKey} />
              </div>
            </div>
          ))}
        </GridLayout>
      </main>
    </div>
  );
}
