import { useState, useEffect, useRef } from 'react';
import { Icon, Button } from '../ui';
import api from '../../lib/api';

export default function QueryPreview({ query, onQueryChange, warnings = [], estimating, onEstimate, onApplyLimit, datasetId, dbType, connectionString }) {
  const [topN, setTopN] = useState(50);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewResult, setPreviewResult] = useState(null);
  const prevQueryRef = useRef(query);

  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query;
      setPreviewResult(null);
      setPreviewError('');
    }
  }, [query]);

  if (!query) return null;

  const runPreview = async () => {
    if (!query.trim()) return;
    setPreviewing(true); setPreviewError(''); setPreviewResult(null);
    try {
      const reqBody = connectionString
        ? { dbType, connectionString, query, limit: topN }
        : { datasetId, query, limit: topN };
      const { data } = await api.post('/datasets/db-connector/preview-query', reqBody);
      setPreviewResult(data);
    } catch (err) {
      setPreviewError(err.response?.data?.error || err.message);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="min-w-0 border border-line-soft rounded-xl bg-paper-deep/40 p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-ink-faint whitespace-nowrap shrink-0">Top N</label>
        <input type="number" min={1} max={1000} value={topN}
          onChange={(e) => setTopN(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
          className="field field-sm field-mono w-20 shrink-0" />
        <Button type="button" variant="soft" size="sm" onClick={runPreview} disabled={previewing || !query.trim()} className="shrink-0">
          {previewing ? (
            <><Icon name="refresh" size={12} className="animate-spin inline mr-1" />Ejecutando…</>
          ) : (
            <>Ejecutar preview</>
          )}
        </Button>
        {previewResult && (
          <span className="text-[10px] text-ink-faint shrink-0">{previewResult.count} fila{previewResult.count !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-3">
        <h4 className="text-xs font-semibold text-ink-soft shrink-0">SQL generado</h4>
        {onEstimate && (
          <Button type="button" variant="ghost" size="sm" onClick={onEstimate} disabled={estimating}>
            {estimating ? (
              <><Icon name="refresh" size={12} className="animate-spin inline mr-1" />Estimando…</>
            ) : (
              <><Icon name="sliders" size={12} className="inline mr-1" />Estimar costo</>
            )}
          </Button>
        )}
      </div>
      <textarea
        value={query}
        onChange={(e) => onQueryChange?.(e.target.value)}
        rows={5}
        spellCheck={false}
        className="field field-mono w-full text-xs !p-3 resize-y max-h-56"
      />

      {warnings.length > 0 && (
        <div className="space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg ${
              w.level === 'critical'
                ? 'bg-rust/10 border border-rust/20 text-rust'
                : 'bg-lumen-soft border border-lumen/20 text-lumen-deep'
            }`}>
              <Icon name="alertTriangle" size={14} className="mt-0.5 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
          {warnings.some(w => w.suggestLimit) && onApplyLimit && (
            <Button type="button" variant="soft" size="sm" onClick={() => onApplyLimit(50000)}>
              Agregar LIMIT 50,000
            </Button>
          )}
        </div>
      )}

      {previewError && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-rust/10 border border-rust/20 text-rust">
          <Icon name="alertTriangle" size={14} className="mt-0.5 shrink-0" />
          <span>{previewError}</span>
        </div>
      )}

      {previewResult && (
        <div className="border border-line-soft rounded-lg overflow-auto max-h-64">
          <table className="text-[10px] font-mono w-full border-collapse">
            <thead className="sticky top-0 bg-paper-deep">
              <tr>
                {previewResult.columns.map(c => (
                  <th key={c} className="text-left px-2 py-1 border-b border-line-soft font-semibold whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewResult.rows.map((row, i) => (
                <tr key={i} className="odd:bg-paper-deep/30">
                  {previewResult.columns.map(c => (
                    <td key={c} className="px-2 py-1 border-b border-line-soft/50 whitespace-nowrap">{String(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
