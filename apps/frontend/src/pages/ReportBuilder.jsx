import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import GridLayout from 'react-grid-layout';
import { nanoid } from 'nanoid';
import api from '../lib/api';
import { useReportStore } from '../store/reportStore';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';
import WidgetConfigPanel from '../components/Canvas/WidgetConfigPanel';
import FilterBar from '../components/Canvas/FilterBar';

const WIDGET_TYPES = [
  { type: 'chart', label: 'Gráfico', icon: '📊' },
  { type: 'kpi', label: 'KPI', icon: '🔢' },
  { type: 'table', label: 'Tabla', icon: '📋' },
  { type: 'pivot', label: 'Pivot', icon: '⊞' },
  { type: 'map', label: 'Mapa', icon: '🗺️' },
];

export default function ReportBuilder() {
  const { id } = useParams();
  const { report, widgets, layout, isDirty, setReport, updateLayout, addWidget, save } = useReportStore();
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [sharing, setSharing] = useState(false);
  const [copyMsg, setCopyMsg] = useState(false);

  useEffect(() => {
    api.get(`/reports/${id}`).then(({ data }) => setReport(data));
    return () => setSelectedWidget(null);
  }, [id]);

  useEffect(() => {
    const update = () => {
      const el = document.getElementById('canvas-container');
      if (el) setContainerWidth(el.offsetWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try { await save(); } finally { setSaving(false); }
  };

  const addNewWidget = (type) => {
    addWidget({ id: nanoid(), widgetType: type, config: {}, datasetId: null });
  };

  const toggleShare = async () => {
    setSharing(true);
    try {
      const { data } = await api.post(`/reports/${id}/share`);
      setReport({ ...report, isPublic: data.isPublic, slug: data.slug });
    } finally { setSharing(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/public/${report.slug}`);
    setCopyMsg(true);
    setTimeout(() => setCopyMsg(false), 2000);
  };

  const exportPDF = async () => {
    const res = await api.get(`/reports/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${report?.title}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!report) return <div className="flex items-center justify-center min-h-screen text-slate-500">Cargando...</div>;

  const activeWidget = selectedWidget ? widgets.find((w) => w.id === selectedWidget) : null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col" data-report-ready>
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <Link to="/" className="text-slate-500 hover:text-slate-800 text-sm">← Dashboard</Link>
        <span className="text-slate-300">|</span>
        <h1 className="text-sm font-semibold text-slate-800 flex-1 truncate">{report.title}</h1>
        {isDirty && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Sin guardar</span>}
        <button onClick={toggleShare} disabled={sharing}
          className={`text-xs px-3 py-1.5 rounded-lg transition font-medium flex-shrink-0 ${report.isPublic ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          {report.isPublic ? '🔗 Público' : '🔒 Privado'}
        </button>
        {report.isPublic && report.slug && (
          <button onClick={copyLink}
            className={`text-xs flex-shrink-0 transition ${copyMsg ? 'text-green-600' : 'text-indigo-600 hover:underline'}`}>
            {copyMsg ? '✓ Copiado' : 'Copiar link'}
          </button>
        )}
        <button onClick={exportPDF}
          className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition flex-shrink-0">
          Exportar PDF
        </button>
        <button onClick={handleSave} disabled={saving || !isDirty}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50 font-medium flex-shrink-0">
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </header>

      {/* Filter bar */}
      <FilterBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: widget palette */}
        <aside className="w-44 bg-white border-r border-slate-200 p-3 flex flex-col gap-1.5 flex-shrink-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 px-1">Widgets</p>
          {WIDGET_TYPES.map(({ type, label, icon }) => (
            <button key={type} onClick={() => addNewWidget(type)}
              className="flex items-center gap-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg px-3 py-2 transition text-left w-full">
              <span className="text-base">{icon}</span><span>{label}</span>
            </button>
          ))}
        </aside>

        {/* Center: canvas */}
        <main className="flex-1 overflow-auto p-4" id="canvas-container"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedWidget(null); }}>
          {widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 pointer-events-none">
              <span className="text-5xl">📊</span>
              <p className="text-sm">Agrega widgets desde el panel izquierdo</p>
            </div>
          ) : (
            <GridLayout
              layout={layout}
              cols={12}
              rowHeight={50}
              width={Math.max(containerWidth - 32, 600)}
              onLayoutChange={updateLayout}
              draggableHandle=".drag-handle"
              className="bg-white rounded-xl shadow-sm"
              style={{ minHeight: 400 }}
            >
              {widgets.map((w) => (
                <div key={w.id}
                  className={`bg-white border rounded-xl overflow-hidden flex flex-col cursor-default ${selectedWidget === w.id ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'}`}
                  onClick={(e) => { e.stopPropagation(); setSelectedWidget(w.id); }}
                >
                  <div className="drag-handle h-6 bg-slate-50 border-b border-slate-100 flex items-center px-2 cursor-grab active:cursor-grabbing flex-shrink-0">
                    <span className="text-slate-300 text-xs select-none">⠿⠿</span>
                    <span className="text-xs text-slate-400 ml-2 flex-1 truncate select-none">{w.config?.title || w.widgetType}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedWidget(w.id); }}
                      className="text-slate-400 hover:text-indigo-600 text-xs px-1">⚙</button>
                  </div>
                  <div className="flex-1 overflow-hidden p-2 min-h-0">
                    <WidgetRenderer widget={w} />
                  </div>
                </div>
              ))}
            </GridLayout>
          )}
        </main>

        {/* Right: config panel */}
        {activeWidget && (
          <WidgetConfigPanel
            key={activeWidget.id}
            widget={activeWidget}
            onClose={() => setSelectedWidget(null)}
          />
        )}
      </div>
    </div>
  );
}
