import { Icon, Button } from '../ui';

export default function QueryPreview({ query, warnings = [], estimating, onEstimate, onApplyLimit }) {
  if (!query) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-ink-soft">SQL generado</h4>
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
      <pre className="text-xs font-mono bg-paper-deep border border-line-soft rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48">
        {query}
      </pre>

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
    </div>
  );
}
