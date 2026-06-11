import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import api from '../lib/api';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';
import { ReportSkeleton, Wordmark } from '../components/ui';

export default function PublicReport() {
  const { slug } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });

  useEffect(() => {
    api.get(`/reports/public/${slug}`).then(({ data }) => setReport(data)).catch(() => setError('Reporte no encontrado'));
  }, [slug]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen paper-bg gap-3">
        <Wordmark />
        <p className="text-ink-faint text-sm">{error}</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="min-h-screen paper-bg flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4"><Wordmark size="text-base" /></div>
        <ReportSkeleton />
      </div>
    );
  }

  return (
    <div className="min-h-screen paper-bg" data-report-ready>
      <header className="bg-surface/85 backdrop-blur border-b border-line px-6 py-3 flex items-center gap-4 sticky top-0 z-40">
        <Wordmark size="text-base" />
        <span className="text-line">|</span>
        <div className="min-w-0">
          <h1 className="font-display text-lg text-ink truncate">{report.title}</h1>
          {report.description && <p className="text-xs text-ink-faint truncate">{report.description}</p>}
        </div>
      </header>
      <main ref={containerRef} className="p-4 sm:p-6">
        <GridLayout layout={report.layout || []} width={Math.max(width - 32, 320)}
          gridConfig={{ cols: 12, rowHeight: 50 }}
          dragConfig={{ enabled: false }} resizeConfig={{ enabled: false }}>
          {(report.widgets || []).map((w) => (
            <div key={w.id} className="bg-surface border border-line-soft rounded-xl overflow-hidden flex flex-col shadow-card">
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
