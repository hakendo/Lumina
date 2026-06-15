import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import api from '../lib/api';
import WidgetRenderer from '../components/Canvas/WidgetRenderer';
import { ReportSkeleton, Wordmark } from '../components/ui';

function resolvePages(report) {
  if (report.pages?.length) return report.pages;
  return [{
    id: 'legacy', title: 'Página 1', order: 0,
    layout: report.layout || [], widgets: report.widgets || [],
  }];
}

export default function PublicReport() {
  const { slug } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [activePageId, setActivePageId] = useState(null);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });

  useEffect(() => {
    api.get(`/reports/public/${slug}`)
      .then(({ data }) => {
        setReport(data);
        setActivePageId(resolvePages(data)[0]?.id ?? null);
      })
      .catch(() => setError('Reporte no encontrado'));
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

  const pages = resolvePages(report);
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];
  const pageWidgets = activePage?.widgets ?? [];
  const pageLayout = activePage?.layout ?? [];

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

      {pages.length > 1 && (
        <div className="bg-surface border-b border-line flex items-center overflow-x-auto px-1 gap-0.5">
          {pages.map((page) => (
            <button key={page.id}
              onClick={() => setActivePageId(page.id)}
              className={`text-xs px-3 py-2.5 font-medium border-b-2 transition whitespace-nowrap ${
                page.id === activePageId
                  ? 'border-lumen-deep text-lumen-deep'
                  : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              {page.title}
            </button>
          ))}
        </div>
      )}

      <main ref={containerRef} className="p-4 sm:p-6">
        <GridLayout layout={pageLayout} width={Math.max(width - 32, 320)}
          gridConfig={{ cols: 12, rowHeight: 50 }}
          dragConfig={{ enabled: false }} resizeConfig={{ enabled: false }}>
          {pageWidgets.map((w) => (
            <div key={w.id} className="bg-surface border border-line-soft rounded-xl overflow-hidden flex flex-col shadow-card">
              <div className="flex-1 p-2 overflow-hidden">
                <WidgetRenderer widget={w} publicSlug={slug} />
              </div>
            </div>
          ))}
        </GridLayout>
      </main>
    </div>
  );
}
