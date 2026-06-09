import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import GridLayout from 'react-grid-layout';
import api from '../lib/api';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';

export default function PublicReport() {
  const { slug } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/reports/public/${slug}`).then(({ data }) => setReport(data)).catch(() => setError('Reporte no encontrado'));
  }, [slug]);

  if (error) return <div className="flex items-center justify-center min-h-screen text-slate-500">{error}</div>;
  if (!report) return <div className="flex items-center justify-center min-h-screen text-slate-500">Cargando...</div>;

  return (
    <div className="min-h-screen bg-slate-100" data-report-ready>
      <header className="bg-white border-b border-slate-200 px-6 py-3">
        <h1 className="text-lg font-bold text-slate-800">{report.title}</h1>
        {report.description && <p className="text-sm text-slate-500 mt-0.5">{report.description}</p>}
      </header>
      <main className="p-6">
        <GridLayout layout={report.layout || []} cols={12} rowHeight={50} width={1200} isDraggable={false} isResizable={false}>
          {(report.widgets || []).map((w) => (
            <div key={w.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
              <div className="flex-1 p-2 overflow-hidden">
                <WidgetRenderer widget={w} />
              </div>
            </div>
          ))}
        </GridLayout>
      </main>
    </div>
  );
}
