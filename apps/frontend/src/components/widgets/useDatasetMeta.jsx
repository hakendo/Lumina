import { useState, useEffect } from 'react';
import api from '../../lib/api';

export function formatRelativeTime(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

export function useDatasetMeta(datasetId) {
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    api.get(`/datasets/${datasetId}`)
      .then(({ data: ds }) => {
        if (alive) setMeta({ lastSyncAt: ds.config?.lastSyncAt || ds.createdAt, name: ds.name, sourceType: ds.sourceType });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [datasetId]);

  return meta;
}

export function WidgetFooter({ dataCount, dataLabel, meta }) {
  const relTime = meta ? formatRelativeTime(meta.lastSyncAt) : null;
  return (
    <div className="flex items-center gap-2 px-2 py-0.5 shrink-0 text-[9px] font-mono text-ink-faint/60">
      {dataCount != null && (
        <span>{dataCount.toLocaleString()} {dataLabel || 'registros'}</span>
      )}
      <div className="flex-1" />
      {relTime && <span title={meta.lastSyncAt}>Actualizado {relTime.toLowerCase()}</span>}
    </div>
  );
}
