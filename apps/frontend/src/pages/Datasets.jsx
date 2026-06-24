import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../lib/api';
import { invalidateDatasetCache } from '../lib/datasetCache';
import { AppHeader, Button, ConfirmModal, EmptyState, Field, Icon, Modal, SkeletonCards } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import SchemaExplorer from '../components/QueryBuilder/SchemaExplorer';
import JoinBuilder from '../components/QueryBuilder/JoinBuilder';
import QueryPreview from '../components/QueryBuilder/QueryPreview';

const SOURCES = {
  csv: { label: 'CSV / Excel', icon: 'file' },
  api: { label: 'API', icon: 'globe' },
  db: { label: 'Base de datos', icon: 'database' },
  derived: { label: 'Dataset Derivado', icon: 'layers' },
};

export default function Datasets() {
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = user?.role === 'superadmin';

  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [areas, setAreas] = useState([]);
  const [slots, setSlots] = useState([]);
  const [tab, setTab] = useState('csv'); // csv | api | db
  const [preview, setPreview] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [status, setStatus] = useState('');
  const [syncingId, setSyncingId] = useState(null);
  const syncControllerRef = useRef(null);
  const [idFieldTarget, setIdFieldTarget] = useState(null);
  const [storageData, setStorageData] = useState(null);

  const canSeeStorage = user?.role === 'org_admin' || user?.role === 'superadmin';

  useEffect(() => {
    Promise.all([
      api.get('/datasets'),
      api.get('/areas/mine'),
      api.get('/datasets/slots'),
    ]).then(([{ data: ds }, { data: ar }, { data: sl }]) => {
      setDatasets(Array.isArray(ds) ? ds : []);
      setAreas(Array.isArray(ar) ? ar : []);
      setSlots(Array.isArray(sl) ? sl : []);
    }).catch(() => setLoadError('No se pudieron cargar los datasets.'))
      .finally(() => setLoading(false));

    if (canSeeStorage && user?.orgId) {
      api.get('/org/storage').then(({ data }) => setStorageData(data)).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bindSlot = async (slotId, datasetId) => {
    try {
      const { data } = await api.post(`/datasets/slots/${slotId}/bind`, { datasetId });
      setSlots((prev) => prev.map((s) => s.id === slotId
        ? { ...s, clientDatasetId: datasetId, clientDataset: datasets.find((d) => d.id === datasetId) || s.clientDataset }
        : s));
      setStatus(`✓ Slot vinculado — ${data.widgetsUpdated} widget(s) actualizados. Recarga el reporte para ver los datos.`);
      setTimeout(() => setStatus(''), 8000);
    } catch (err) {
      setStatus(`Error al vincular: ${err.response?.data?.error || err.message}`);
      setTimeout(() => setStatus(''), 8000);
    }
  };

  const addDataset = (ds) => setDatasets((prev) => [ds, ...prev]);
  const replaceDataset = (ds) => setDatasets((prev) => prev.map((d) => (d.id === ds.id ? ds : d)));

  const confirmDelete = async () => {
    const id = deleteTarget.id;
    setDeleteTarget(null);
    await api.delete(`/datasets/${id}`);
    setDatasets((d) => d.filter((x) => x.id !== id));
    if (preview?.id === id) setPreview(null);
  };

  const loadPreview = async (ds) => {
    const { data } = await api.get(`/datasets/${ds.id}/rows`);
    setPreview({ ...ds, rows: data.slice(0, 20) });
  };

  const syncDataset = async (ds) => {
    const controller = new AbortController();
    syncControllerRef.current = controller;
    setSyncingId(ds.id);
    setDatasets((prev) => prev.map((d) => d.id === ds.id
      ? { ...d, config: { ...d.config, lastSyncStatus: 'syncing', lastSyncError: null } }
      : d));
    try {
      const { data } = await api.post(`/datasets/${ds.id}/fetch`, {}, { signal: controller.signal });
      if (!data.unchanged) invalidateDatasetCache(ds.id);
      const msg = data.unchanged
        ? `"${ds.name}" — sin cambios (datos idénticos al último sync)`
        : `✓ "${ds.name}" — ${data.count} filas actualizadas`;
      setStatus(msg);
      setDatasets((prev) => prev.map((d) => d.id === ds.id
        ? { ...d, _count: { rows: data.count }, config: { ...d.config, lastSyncStatus: data.unchanged ? 'unchanged' : 'ok', lastSyncError: null } }
        : d));
      setTimeout(() => setStatus(''), 5000);
      if (data.needsIdConfig && data.columns?.length) {
        setIdFieldTarget({ datasetId: ds.id, datasetName: ds.name, columns: data.columns });
      }
    } catch (err) {
      if (err.code === 'ERR_CANCELED') {
        setDatasets((prev) => prev.map((d) => d.id === ds.id
          ? { ...d, config: { ...d.config, lastSyncStatus: null, lastSyncError: null } }
          : d));
      } else {
        const errorType = err.response?.data?.errorType ?? 'connection_error';
        const errorMsg = err.response?.data?.error || err.message;
        setStatus(`Error: ${errorMsg}`);
        setDatasets((prev) => prev.map((d) => d.id === ds.id
          ? { ...d, config: { ...d.config, lastSyncStatus: errorType, lastSyncError: errorMsg } }
          : d));
        setTimeout(() => setStatus(''), 8000);
      }
    } finally {
      setSyncingId(null);
      syncControllerRef.current = null;
    }
  };

  const stopSync = () => syncControllerRef.current?.abort();

  const [syncingAll, setSyncingAll] = useState(false);

  const syncAll = async () => {
    setSyncingAll(true);
    setStatus('Sincronizando todos los datasets…');
    try {
      const { data } = await api.post('/datasets/sync-all');
      // Invalidate cache for all updated datasets
      data.details.filter((r) => !r.unchanged && !r.error).forEach((r) => invalidateDatasetCache(r.id));
      // Refresh dataset list to pick up new row counts
      const { data: fresh } = await api.get('/datasets');
      setDatasets(Array.isArray(fresh) ? fresh : []);
      // Show idField config modal for the first dataset needing it
      const needsConfig = data.details.find((r) => r.needsIdConfig && r.columns?.length);
      if (needsConfig) {
        const ds = fresh.find((d) => d.id === needsConfig.id);
        setIdFieldTarget({ datasetId: needsConfig.id, datasetName: ds?.name || needsConfig.name, columns: needsConfig.columns });
      }
      const parts = [];
      if (data.synced) parts.push(`${data.synced} actualizado${data.synced > 1 ? 's' : ''}`);
      if (data.unchanged) parts.push(`${data.unchanged} sin cambios`);
      if (data.errors) parts.push(`${data.errors} error${data.errors > 1 ? 'es' : ''}`);
      setStatus(`✓ Sync completo — ${parts.join(', ')}`);
      setTimeout(() => setStatus(''), 8000);
    } catch (err) {
      setStatus(`Error en sync masivo: ${err.response?.data?.error || err.message}`);
      setTimeout(() => setStatus(''), 8000);
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 animate-rise">
          <div>
            <h2 className="font-display text-3xl text-ink">Datasets</h2>
            <p className="text-ink-faint text-sm mt-1">Conecta archivos, APIs y bases de datos.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {status && (
              <span className="text-sm text-lumen-deep bg-lumen-soft px-3 py-1.5 rounded-full font-mono text-xs">
                {status}
              </span>
            )}
            {Array.isArray(datasets) && datasets.some((d) => ['api', 'db'].includes(d.sourceType)) && (
              <Button size="sm" variant="soft" onClick={syncAll} disabled={syncingAll || !!syncingId}
                className="flex items-center gap-1.5 whitespace-nowrap">
                <Icon name="refresh" size={13} className={syncingAll ? 'animate-spin' : ''} />
                {syncingAll ? 'Sincronizando…' : 'Sync todo'}
              </Button>
            )}
          </div>
        </div>

        {/* Storage gauge — solo org_admin / superadmin */}
        {storageData && (
          <div className="mb-6 p-4 bg-surface border border-line rounded-xl flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-ink-soft">Almacenamiento</span>
                <span className="text-xs font-mono text-ink-soft">
                  {storageData.usedMB >= 1024
                    ? `${(storageData.usedMB / 1024).toFixed(1)} GB`
                    : `${storageData.usedMB.toFixed(1)} MB`}
                  {storageData.limitMB && ` / ${storageData.limitMB >= 1024 ? `${(storageData.limitMB / 1024).toFixed(1)} GB` : `${storageData.limitMB.toFixed(1)} MB`}`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-paper-deep overflow-hidden">
                {storageData.limitMB ? (
                  <div
                    className={`h-full rounded-full transition-all ${
                      storageData.pct >= 90 ? 'bg-rust' : storageData.pct >= 70 ? 'bg-lumen' : 'bg-sea'
                    }`}
                    style={{ width: `${Math.min(storageData.pct ?? 0, 100)}%` }}
                  />
                ) : (
                  <div className="h-full w-full bg-paper-deep" />
                )}
              </div>
            </div>
            {storageData.pct >= 90 && (
              <span className="text-xs text-rust font-medium whitespace-nowrap shrink-0">
                {Math.round(storageData.pct)}% usado
              </span>
            )}
          </div>
        )}

        {/* Conectores */}
        <div className="bg-surface border border-line-soft rounded-xl shadow-card mb-8 overflow-hidden">
          <div className="flex border-b border-line-soft overflow-x-auto">
            {Object.entries(SOURCES).map(([key, { label, icon }]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`inline-flex items-center gap-2 px-4 sm:px-5 py-3 text-sm font-medium transition cursor-pointer border-b-2 -mb-px whitespace-nowrap ${
                  tab === key
                    ? 'border-lumen text-lumen-deep bg-lumen-soft/40'
                    : 'border-transparent text-ink-faint hover:text-ink-soft'
                }`}>
                <Icon name={icon} size={15} /> {label}
              </button>
            ))}
          </div>
          <div className="p-5">
            {tab === 'csv' && <CSVForm onCreated={addDataset} areas={areas} isSuperadmin={isSuperadmin} />}
            {tab === 'api' && <APIForm onCreated={addDataset} areas={areas} isSuperadmin={isSuperadmin} />}
            {tab === 'db' && <DBForm onCreated={addDataset} areas={areas} isSuperadmin={isSuperadmin} />}
            {tab === 'derived' && <DerivedDatasetForm onCreated={addDataset} areas={areas} availableDatasets={datasets} isSuperadmin={isSuperadmin} />}
          </div>
        </div>

        {/* Slots pendientes de configuración (plantillas asignadas) */}
        {slots.filter((s) => !s.clientDatasetId).length > 0 && (
          <div className="bg-lumen-soft border border-lumen-line rounded-xl p-5 mb-8 animate-rise">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="link" size={15} className="text-lumen-deep" />
              <h3 className="font-display text-sm text-lumen-deep font-semibold">Fuentes de datos pendientes</h3>
              <span className="text-[11px] bg-lumen text-paper rounded-full px-2 py-0.5 font-mono">
                {slots.filter((s) => !s.clientDatasetId).length}
              </span>
            </div>
            <p className="text-xs text-ink-faint mb-4">
              Tienes reportes basados en plantillas que necesitan que configures sus fuentes de datos.
            </p>
            <div className="space-y-3">
              {slots.filter((s) => !s.clientDatasetId).map((slot) => (
                <div key={slot.id} className="bg-surface border border-line-soft rounded-lg p-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{slot.report?.title}</p>
                    <p className="text-xs font-mono text-lumen-deep">slot: {slot.slotName}</p>
                  </div>
                  <select
                    className="field field-sm flex-1 min-w-[200px]"
                    defaultValue=""
                    onChange={(e) => e.target.value && bindSlot(slot.id, e.target.value)}>
                    <option value="">— Seleccionar dataset —</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} ({d.sourceType})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {loadError ? (
          <p className="text-rust text-sm bg-rust-soft px-4 py-3 rounded-lg">{loadError}</p>
        ) : loading ? (
          <SkeletonCards count={4} height="h-28" />
        ) : datasets.length === 0 ? (
          <EmptyState icon="database" title="Sin datasets todavía"
            hint="Sube un archivo o conecta una fuente arriba para empezar." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {datasets.map((ds, i) => (
              <DatasetCard key={ds.id} ds={ds} index={i}
                onDelete={(target) => setDeleteTarget(target)}
                onPreview={loadPreview}
                onSync={syncDataset}
                onEdit={() => setEditTarget(ds)}
                isSyncing={syncingId === ds.id}
                onStopSync={stopSync}
              />
            ))}
          </div>
        )}

        {/* Vista previa */}
        {preview && (
          <div className="mt-8 bg-surface border border-line-soft rounded-xl shadow-card p-5 animate-rise">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-base text-ink">
                Vista previa <span className="text-ink-faint">·</span> {preview.name}
              </h2>
              <button onClick={() => setPreview(null)}
                className="text-ink-faint hover:text-ink transition cursor-pointer" aria-label="Cerrar vista previa">
                <Icon name="x" size={16} />
              </button>
            </div>
            {preview.rows?.length ? (
              <div className="overflow-auto max-h-72 rounded-lg border border-line-soft">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>{Object.keys(preview.rows[0]).map((c) => (
                      <th key={c} className="text-left px-3 py-2 bg-paper-deep border-b border-line font-mono font-medium text-ink-soft whitespace-nowrap sticky top-0">{c}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} className={i % 2 ? 'bg-paper/60' : ''}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 border-b border-line-soft text-ink-soft max-w-[200px] truncate font-mono">{String(v ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-ink-faint text-sm">Sin datos — usa "Sincronizar" para cargar.</p>}
          </div>
        )}

        {deleteTarget && (
          <ConfirmModal
            title="Eliminar dataset"
            message={`"${deleteTarget.name}" y todas sus filas se eliminarán. Los widgets que lo usan quedarán sin datos.`}
            onConfirm={confirmDelete}
            onClose={() => setDeleteTarget(null)}
          />
        )}

        {editTarget && (
          <Modal title={`Editar · ${editTarget.name}`} onClose={() => setEditTarget(null)} maxWidth="max-w-3xl">
            {editTarget.sourceType === 'api' && (
              <APIForm initial={editTarget} onCreated={() => {}} isSuperadmin={isSuperadmin}
                onSaved={(updated) => { replaceDataset(updated); setEditTarget(null); }} />
            )}
            {editTarget.sourceType === 'db' && (
              <DBForm initial={editTarget} onCreated={() => {}} isSuperadmin={isSuperadmin}
                onSaved={(updated) => { replaceDataset(updated); setEditTarget(null); }} />
            )}
            {editTarget.sourceType === 'derived' && (
              <DerivedDatasetEditor dataset={editTarget} areas={areas} availableDatasets={datasets}
                onSaved={(updated) => { replaceDataset(updated); setEditTarget(null); }} />
            )}
          </Modal>
        )}

        {idFieldTarget && (
          <IdFieldModal
            datasetId={idFieldTarget.datasetId}
            datasetName={idFieldTarget.datasetName}
            columns={idFieldTarget.columns}
            onSave={(idField) => {
              setDatasets((prev) => prev.map((d) => d.id === idFieldTarget.datasetId
                ? { ...d, config: { ...d.config, idField } }
                : d));
              setIdFieldTarget(null);
            }}
            onClose={() => setIdFieldTarget(null)}
          />
        )}
      </main>
    </div>
  );
}

// ── Sync status badge ─────────────────────────────────────────────────────────

const SYNC_STATUS = {
  syncing:          { dot: 'bg-lumen-deep animate-pulse', label: 'Sincronizando…',       title: null },
  ok:               { dot: 'bg-sea',                      label: 'Sincronizado',          title: null },
  unchanged:        { dot: 'bg-sea/50',                   label: 'Sin cambios',           title: 'Los datos de la fuente son idénticos al último sync' },
  ssl_error:        { dot: 'bg-rust animate-pulse',       label: 'Error de certificado',  title: null },
  connection_error: { dot: 'bg-rust animate-pulse',       label: 'Sin conexión',          title: null },
  http_error:       { dot: 'bg-rust animate-pulse',       label: 'Error HTTP',            title: null },
  parse_error:      { dot: 'bg-rust animate-pulse',       label: 'Respuesta inválida',    title: null },
};

function IdFieldModal({ datasetId, datasetName, columns, onSave, onClose }) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/datasets/${datasetId}/id-field`, { idField: selected || null });
      onSave(selected || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Configurar campo ID único" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="bg-lumen-soft border border-lumen-line rounded-lg px-4 py-3 text-sm text-ink-soft">
          <p className="font-medium text-ink mb-1">
            <Icon name="database" size={13} className="inline mr-1.5 text-lumen-deep" />
            {datasetName}
          </p>
          <p className="text-xs text-ink-faint">
            Selecciona el campo que identifica de forma única cada registro. En futuros syncs, las filas se actualizarán por ese campo en lugar de borrar y reinsertar todo.
          </p>
        </div>

        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {columns.map((col) => (
            <label key={col}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                selected === col
                  ? 'border-lumen bg-lumen-soft/60 text-lumen-deep'
                  : 'border-line-soft hover:border-line text-ink-soft'
              }`}>
              <input type="radio" name="idField" value={col} checked={selected === col}
                onChange={() => setSelected(col)} className="accent-lumen-deep" />
              <span className="font-mono text-sm">{col}</span>
            </label>
          ))}
        </div>

        <p className="text-xs text-ink-faint">
          ¿No hay un campo único? Puedes omitir esto y el sistema reemplazará todos los datos en cada sync.
        </p>

        <div className="flex justify-between gap-2 pt-1">
          <Button variant="soft" size="sm" onClick={() => { api.patch(`/datasets/${datasetId}/id-field`, { idField: null }); onSave(null); }}>
            Sin campo ID
          </Button>
          <Button size="sm" onClick={save} disabled={!selected || busy}>
            {busy ? 'Guardando…' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SyncStatusBadge({ config }) {
  if (!config) return null;
  const { lastSyncStatus, lastSyncError, allowInsecureSsl } = config;
  const info = lastSyncStatus ? SYNC_STATUS[lastSyncStatus] : null;

  if (!info && !allowInsecureSsl) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5 mb-1">
      {info && (
        <span title={lastSyncError || undefined}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-paper-deep border border-line-soft text-ink-soft cursor-default">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${info.dot}`} />
          {info.label}
          {lastSyncError && <span className="text-ink-faint"> · </span>}
          {lastSyncError && <span className="truncate max-w-[160px] text-ink-faint">{lastSyncError}</span>}
        </span>
      )}
      {allowInsecureSsl && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-lumen-soft border border-lumen-line text-lumen-deep">
          <Icon name="shield-off" size={10} />
          SSL bypass
        </span>
      )}
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function DatasetCard({ ds, index, onDelete, onPreview, onSync, onEdit, isSyncing, onStopSync }) {
  const source = SOURCES[ds.sourceType] || { label: ds.sourceType, icon: 'database' };
  const editable = ['api', 'db', 'derived'].includes(ds.sourceType);

  return (
    <div className={`bg-surface border rounded-xl p-4 shadow-card transition animate-rise ${
      isSyncing ? 'border-lumen-deep/40 shadow-lumen-soft' : 'border-line-soft hover:shadow-lift hover:border-lumen-line'
    }`}
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
      <div className="flex items-center gap-3 mb-2">
        <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 transition ${
          isSyncing ? 'bg-lumen-soft text-lumen-deep' : 'bg-lumen-soft text-lumen-deep'
        }`}>
          <Icon name={source.icon} size={17} className={isSyncing ? 'animate-pulse' : ''} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-ink truncate flex items-center gap-1.5">
            {ds.name}
            {ds.slotName && (
              <span className="text-[10px] font-mono bg-lumen-soft text-lumen-deep px-1.5 py-0.5 rounded shrink-0">
                slot:{ds.slotName}
              </span>
            )}
            {ds.config?.idField && (
              <span className="text-[10px] font-mono bg-paper-deep border border-line-soft text-ink-faint px-1.5 py-0.5 rounded shrink-0"
                title="Campo ID configurado para upsert">
                id:{ds.config.idField}
              </span>
            )}
          </p>
          <p className="font-mono text-[11px] text-ink-faint">
            {source.label} · {ds._count?.rows ?? 0} filas
            {ds.area && <> · <span className="text-lumen-deep">{ds.area.name}</span></>}
          </p>
        </div>
        {isSyncing && (
          <span className="text-[10px] font-mono text-lumen-deep bg-lumen-soft px-2 py-0.5 rounded-full shrink-0 animate-pulse">
            en curso
          </span>
        )}
      </div>

      {ds.sourceType === 'api' && ds.config?.url && (
        <p className="font-mono text-[11px] text-ink-faint truncate mb-2">
          <span className="bg-paper-deep px-1.5 py-0.5 rounded text-ink-soft">{ds.config.method || 'GET'}</span>{' '}
          {ds.config.url}
        </p>
      )}
      {ds.sourceType === 'db' && ds.config?.dbType && (
        <p className="font-mono text-[11px] text-ink-faint mb-2">
          <span className="bg-paper-deep px-1.5 py-0.5 rounded text-ink-soft">{ds.config.dbType}</span>{' '}
          · query configurado
        </p>
      )}
      <SyncStatusBadge config={ds.config} />

      <div className="flex gap-1 mt-2 flex-wrap">
        <CardBtn icon="eye" label="Vista previa" onClick={() => onPreview(ds)} disabled={isSyncing} />
        {editable && !isSyncing && (
          <CardBtn icon="refresh" label="Sincronizar" accent onClick={() => onSync(ds)} />
        )}
        {editable && isSyncing && (
          <>
            <CardBtn icon="refresh" label="Sincronizando…" accent disabled iconSpin />
            <CardBtn icon="x" label="Detener" danger onClick={onStopSync} />
          </>
        )}
        {editable && <CardBtn icon="pencil" label="Editar" onClick={onEdit} disabled={isSyncing} />}
        <button onClick={() => onDelete(ds)} title="Eliminar" disabled={isSyncing}
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint hover:text-rust hover:bg-rust-soft rounded-lg px-2 py-1 transition cursor-pointer disabled:opacity-30 disabled:pointer-events-none">
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}

function CardBtn({ icon, label, onClick, accent = false, danger = false, disabled = false, iconSpin = false }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 transition ${
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'cursor-pointer'
      } ${
        danger   ? 'text-rust hover:bg-rust-soft' :
        accent   ? 'text-sea hover:bg-sea-soft' :
                   'text-ink-soft hover:bg-paper-deep hover:text-ink'
      }`}>
      <Icon name={icon} size={13} className={iconSpin ? 'animate-spin' : ''} /> {label}
    </button>
  );
}

// ── Formularios ──────────────────────────────────────────────────────────────

function AreaSelect({ areas, value, onChange }) {
  if (!areas.length) return null; // superadmin has no org/areas
  return (
    <Field label="Área">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
        <option value="">— Seleccionar área —</option>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </Field>
  );
}

function CSVForm({ onCreated, areas }) {
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();

  const submit = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files[0];
    if (!file) return setMsg('Selecciona un archivo');
    if (!name.trim()) return setMsg('Ingresa un nombre');
    if (areas.length && !areaId) return setMsg('Selecciona un área');
    setBusy(true); setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name);
      form.append('areaId', areaId);
      const { data } = await api.post('/datasets/upload', form);
      const area = areas.find((a) => a.id === areaId);
      onCreated({ id: data.id, name: data.name, sourceType: 'csv', config: {}, _count: { rows: data.count }, area: area ? { id: area.id, name: area.name } : null });
      setName(''); setAreaId(''); fileRef.current.value = '';
      setMsg(`✓ ${data.count} filas importadas`);
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Ventas 2024" className="field" />
      </Field>
      <AreaSelect areas={areas} value={areaId} onChange={setAreaId} />
      <Field label="Archivo">
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.ods"
          className="text-sm text-ink-soft file:mr-3 file:text-xs file:bg-lumen-soft file:text-lumen-deep file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:cursor-pointer file:font-medium" />
      </Field>
      <Button type="submit" disabled={busy}>{busy ? 'Subiendo…' : 'Subir archivo'}</Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}
    </form>
  );
}

// Réplica de extractRows del backend (services/dataParser.js) para que el
// preview del ejemplo coincida exactamente con lo que traerá "Sincronizar".
const ENVELOPE_KEYS = ['data', 'results', 'items', 'rows', 'records'];

function extractSampleRows(json, dataPath) {
  if (dataPath) {
    const value = dataPath.split('.').reduce((obj, key) => obj?.[key], json);
    return Array.isArray(value) ? value : (value !== undefined ? [value] : []);
  }
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const key of [...ENVELOPE_KEYS, ...Object.keys(json)]) {
      const v = json[key];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    }
  }
  return [json];
}

// Busca en el JSON de ejemplo todos los arrays de objetos (candidatos a dataPath)
function findArrayPaths(json) {
  const found = [];
  const walk = (node, path, depth) => {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && node[0] !== null && typeof node[0] === 'object' && !Array.isArray(node[0])) {
        found.push({ path, count: node.length, columns: Object.keys(node[0]) });
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(json, '', 0);
  return found;
}

// Editor clave-valor para headers y query params
function KVEditor({ rows, onChange, keyPlaceholder, valuePlaceholder, addLabel }) {
  const update = (i, field, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input className="field field-sm field-mono flex-1" placeholder={keyPlaceholder}
            value={r.k} onChange={(e) => update(i, 'k', e.target.value)} />
          <input className="field field-sm field-mono flex-[1.4]" placeholder={valuePlaceholder}
            value={r.v} onChange={(e) => update(i, 'v', e.target.value)} />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label="Quitar" className="text-ink-faint hover:text-rust transition cursor-pointer p-1">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { k: '', v: '' }])}
        className="inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
        <Icon name="plus" size={12} /> {addLabel}
      </button>
    </div>
  );
}

const rowsToObject = (rows) => {
  const o = {};
  for (const { k, v } of rows) if (k.trim()) o[k.trim()] = v;
  return o;
};

function APIForm({ onCreated, initial = {}, onSaved, areas = [], isSuperadmin = false }) {
  const isEdit = !!onSaved;
  const storedHeaderKeys = initial.config?.headerKeys || [];
  const storedQueryKeys = initial.config?.queryParamKeys || [];
  const [name, setName] = useState(initial.name || '');
  const [areaId, setAreaId] = useState(initial.areaId || '');
  const [slotName, setSlotName] = useState(initial.slotName || '');
  const [url, setUrl] = useState(initial.config?.url || '');
  const [method, setMethod] = useState(initial.config?.method || 'GET');
  const [dataPath, setDataPath] = useState(initial.config?.dataPath || '');
  // headers/queryParams/body guardados viajan cifrados y nunca llegan al
  // cliente: en edición arrancan vacíos y "vacío" significa "no cambiar".
  const [headerRows, setHeaderRows] = useState([]);
  const [queryRows, setQueryRows] = useState([]);
  const [clearHeaders, setClearHeaders] = useState(false);
  const [clearQuery, setClearQuery] = useState(false);
  const [body, setBody] = useState('');
  const [sample, setSample] = useState('');
  const [allowInsecureSsl, setAllowInsecureSsl] = useState(initial.config?.allowInsecureSsl ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const parseJSON = (str, label) => {
    try { return JSON.parse(str); }
    catch { throw new Error(`${label}: JSON inválido`); }
  };

  // Análisis del ejemplo pegado (solo en el cliente, no viaja al servidor)
  let sampleJson = null, sampleError = '', candidates = [];
  if (sample.trim()) {
    try {
      sampleJson = JSON.parse(sample);
      candidates = findArrayPaths(sampleJson);
    } catch { sampleError = 'JSON inválido — pega la respuesta completa de la API.'; }
  }
  const sampleRows = sampleJson !== null ? extractSampleRows(sampleJson, dataPath).slice(0, 5) : [];
  const sampleCols = sampleRows.length && typeof sampleRows[0] === 'object' && sampleRows[0] !== null
    ? Object.keys(sampleRows[0]) : [];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (!isEdit && areas.length && !areaId) throw new Error('Selecciona un área');
      const payload = { name, url, method, dataPath, allowInsecureSsl, ...(!isEdit && { areaId }), ...(isSuperadmin && slotName.trim() && { slotName: slotName.trim() }) };
      // Solo enviar sensibles si el usuario escribió algo; en edición,
      // omitirlos conserva los guardados (cifrados) en el backend.
      const h = rowsToObject(headerRows);
      if (Object.keys(h).length) payload.headers = h;
      else if (clearHeaders || !isEdit) payload.headers = {};
      const q = rowsToObject(queryRows);
      if (Object.keys(q).length) payload.queryParams = q;
      else if (clearQuery || !isEdit) payload.queryParams = {};
      if (body.trim()) payload.body = parseJSON(body, 'Body');
      else if (!isEdit) payload.body = null;
      let data;
      if (isEdit) {
        ({ data } = await api.put(`/datasets/${initial.id}/api-connector`, payload));
        onSaved(data);
      } else {
        ({ data } = await api.post('/datasets/api-connector', payload));
        const area = areas.find((a) => a.id === areaId);
        onCreated({ id: data.id, name: data.name, sourceType: 'api', slotName: data.slotName || null, config: data.config, _count: { rows: 0 }, area: area ? { id: area.id, name: area.name } : null });
        setName(''); setAreaId(''); setUrl(''); setHeaderRows([]); setQueryRows([]); setBody(''); setDataPath(''); setSample(''); setSlotName('');
      }
      setMsg('✓ Conector guardado');
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!isEdit && (
        <>
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. API de clientes" className="field" />
          </Field>
          <AreaSelect areas={areas} value={areaId} onChange={setAreaId} />
          {isSuperadmin && (
            <Field label="Nombre de slot (opcional)"
              hint="Identifica esta fuente en plantillas base. Los clientes configurarán sus propias credenciales para este slot.">
              <input value={slotName} onChange={(e) => setSlotName(e.target.value)}
                placeholder="ej. ventas_api, rrhh_db" className="field field-mono" />
            </Field>
          )}
        </>
      )}
      <div className="flex gap-2">
        <div className="w-28">
          <Field label="Método">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="field field-sm">
              {['GET', 'POST', 'PUT'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex-1">
          <Field label="URL">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/data" className="field field-mono" />
          </Field>
        </div>
      </div>
      <Field label="Data path (opcional)"
        hint="Ruta al array de filas dentro de la respuesta. Pega un ejemplo abajo para detectarla.">
        <input value={dataPath} onChange={(e) => setDataPath(e.target.value)} placeholder="ej. data.results" className="field field-mono" />
      </Field>
      <Field label="Headers (opcional — incluye API keys aquí)"
        hint={isEdit && storedHeaderKeys.length
          ? `Guardados (cifrados): ${storedHeaderKeys.join(', ')}. Sin filas = mantenerlos; agregar filas los reemplaza.`
          : 'Se almacenan cifrados con AES-256-GCM.'}>
        <KVEditor rows={headerRows} onChange={setHeaderRows}
          keyPlaceholder="Authorization" valuePlaceholder="Bearer TOKEN" addLabel="Agregar header" />
      </Field>
      {isEdit && storedHeaderKeys.length > 0 && Object.keys(rowsToObject(headerRows)).length === 0 && (
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer -mt-1">
          <input type="checkbox" checked={clearHeaders} onChange={(e) => setClearHeaders(e.target.checked)} />
          Borrar los headers guardados
        </label>
      )}
      <Field label="Query params (opcional)"
        hint={isEdit && storedQueryKeys.length
          ? `Guardados (cifrados): ${storedQueryKeys.join(', ')}. Sin filas = mantenerlos; agregar filas los reemplaza.`
          : 'Se agregan a la URL al sincronizar (?clave=valor). Cifrados: suelen llevar API keys.'}>
        <KVEditor rows={queryRows} onChange={setQueryRows}
          keyPlaceholder="api_key" valuePlaceholder="valor" addLabel="Agregar query param" />
      </Field>
      {isEdit && storedQueryKeys.length > 0 && Object.keys(rowsToObject(queryRows)).length === 0 && (
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer -mt-1">
          <input type="checkbox" checked={clearQuery} onChange={(e) => setClearQuery(e.target.checked)} />
          Borrar los query params guardados
        </label>
      )}
      <Field label="Body JSON (opcional)"
        hint={isEdit
          ? initial.config?.hasBody
            ? 'Body guardado (cifrado). Vacío = mantenerlo; escribe null para quitarlo.'
            : 'Sin body guardado. Deja vacío o escribe uno nuevo.'
          : undefined}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
          placeholder="{}" className="field field-mono resize-y" />
      </Field>

      <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-line p-3 hover:bg-paper-deep transition">
        <input type="checkbox" checked={allowInsecureSsl} onChange={(e) => setAllowInsecureSsl(e.target.checked)}
          className="mt-0.5 accent-lumen" />
        <div>
          <p className="text-sm font-medium text-ink">Ignorar errores de certificado SSL</p>
          <p className="text-xs text-ink-soft mt-0.5">
            Para APIs con certificados auto-firmados o de CA privada. No recomendado en producción.
          </p>
        </div>
      </label>

      {/* Analizador de respuesta de ejemplo: detecta dónde están las filas */}
      <Field label="Respuesta de ejemplo (opcional)"
        hint="Pega aquí una respuesta real de la API. Se analiza en tu navegador, no se envía ni se guarda.">
        <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={4}
          placeholder={'{\n  "status": "ok",\n  "data": { "results": [ { "id": 1, "nombre": "…" } ] }\n}'}
          className="field field-mono resize-y" />
      </Field>
      {sampleError && <p className="text-xs text-rust font-mono">{sampleError}</p>}
      {candidates.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-soft mb-1.5">
            Arrays detectados — elige cuál contiene tus filas:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((c) => (
              <button key={c.path || '(raíz)'} type="button" onClick={() => setDataPath(c.path)}
                className={`text-xs font-mono rounded-lg px-2.5 py-1.5 border transition cursor-pointer ${
                  dataPath === c.path
                    ? 'border-lumen bg-lumen-soft text-lumen-deep font-semibold'
                    : 'border-line text-ink-soft hover:border-lumen-line hover:bg-paper-deep'
                }`}>
                {c.path || '(raíz)'} · {c.count} filas
              </button>
            ))}
          </div>
        </div>
      )}
      {sampleJson !== null && !sampleError && (
        candidates.length === 0 && !dataPath ? (
          <p className="text-xs text-lumen-deep font-mono">
            No se detectó ningún array de objetos en el ejemplo — revisa la respuesta o escribe el data path a mano.
          </p>
        ) : sampleCols.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ink-soft mb-1.5">
              Vista previa con data path <span className="font-mono text-lumen-deep">{dataPath || '(auto)'}</span>:
            </p>
            <div className="overflow-auto max-h-44 rounded-lg border border-line-soft">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>{sampleCols.map((c) => (
                    <th key={c} className="text-left px-2.5 py-1.5 bg-paper-deep border-b border-line font-mono font-medium text-ink-soft whitespace-nowrap sticky top-0">{c}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, i) => (
                    <tr key={i} className={i % 2 ? 'bg-paper/60' : ''}>
                      {sampleCols.map((c) => {
                        const v = row?.[c];
                        return (
                          <td key={c} className="px-2.5 py-1 border-b border-line-soft text-ink-soft max-w-[180px] truncate font-mono">
                            {v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      <Button type="submit" disabled={busy}>
        {busy ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear conector'}
      </Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}
    </form>
  );
}

const DB_DEFAULTS = {
  pg:    { port: '5432', protocol: 'postgresql' },
  mysql: { port: '3306', protocol: 'mysql' },
  mssql: { port: '1433', protocol: 'mssql' },
  oracle:{ port: '1521', protocol: 'oracle' },
  redis: { port: '6379', protocol: 'redis' },
};

function buildConnectionString(dbType, { host, port, user, password, database }) {
  if (dbType === 'mssql') return `Server=${host},${port};Database=${database};User Id=${user};Password=${password};Encrypt=false`;
  if (dbType === 'oracle') return `${user}/${password}@${host}:${port}/${database}`;
  const proto = DB_DEFAULTS[dbType]?.protocol || dbType;
  return `${proto}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function DBForm({ onCreated, initial = {}, onSaved, areas = [], isSuperadmin = false }) {
  const isEdit = !!onSaved;
  const [name, setName] = useState(initial.name || '');
  const [areaId, setAreaId] = useState(initial.areaId || '');
  const [slotName, setSlotName] = useState(initial.slotName || '');
  const [dbType, setDbType] = useState(initial.config?.dbType || 'pg');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState(DB_DEFAULTS['pg'].port);
  const [dbUser, setDbUser] = useState('');
  const [dbPass, setDbPass] = useState('');
  const [dbName, setDbName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [query, setQuery] = useState(initial.config?.query || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [queryMode, setQueryMode] = useState(initial.config?.visualDefinition ? 'visual' : 'direct');
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [selectedTables, setSelectedTables] = useState(initial.config?.visualDefinition?.tables || []);
  const [selectedColumns, setSelectedColumns] = useState(() => {
    const vd = initial.config?.visualDefinition;
    if (!vd?.columns) return {};
    const map = {};
    for (const c of vd.columns) { (map[c.table] ||= []).push(c.column); }
    return map;
  });
  const [joins, setJoins] = useState(initial.config?.visualDefinition?.joins || []);
  const [queryLimit, setQueryLimit] = useState(initial.config?.visualDefinition?.limit || null);
  const [buildingQuery, setBuildingQuery] = useState(false);
  const [schemaViewMode, setSchemaViewMode] = useState('list');
  const [estimating, setEstimating] = useState(false);
  const [costWarnings, setCostWarnings] = useState([]);
  const debounceRef = useRef(null);

  const handleDbTypeChange = (type) => {
    setDbType(type);
    setDbPort(DB_DEFAULTS[type]?.port || '');
  };

  const hasConnFields = dbHost.trim() && dbUser.trim() && dbPass.trim() && (dbType === 'redis' || dbName.trim());

  const currentConnString = useCallback(() => {
    if (!hasConnFields) return '';
    return buildConnectionString(dbType, { host: dbHost, port: dbPort || DB_DEFAULTS[dbType]?.port, user: dbUser, password: dbPass, database: dbName });
  }, [dbType, dbHost, dbPort, dbUser, dbPass, dbName, hasConnFields]);

  const canLoadSchema = hasConnFields || isEdit;

  const loadSchema = async () => {
    setSchemaLoading(true); setMsg('');
    try {
      const connStr = currentConnString();
      let payload;
      if (connStr) {
        payload = { dbType, connectionString: connStr };
      } else if (isEdit && initial.id) {
        payload = { datasetId: initial.id };
      } else {
        setMsg('Completa los datos de conexión primero'); setSchemaLoading(false); return;
      }
      const { data } = await api.post('/datasets/db-connector/introspect', payload);
      setSchema(data);

      if (isEdit && !selectedTables.length && query) {
        const tablePattern = /(?:FROM|JOIN)\s+(?:\[?\w+\]?\.)?(?:\[?)(\w+)(?:\]?)\s/gi;
        const found = new Set();
        let m;
        while ((m = tablePattern.exec(query))) found.add(m[1]);
        if (found.size > 0) {
          const matched = [];
          for (const name of found) {
            const t = data.tables.find(st => st.name.toLowerCase() === name.toLowerCase());
            if (t && !matched.some(s => s.name === t.name)) {
              matched.push({ name: t.name, schema: t.schema, type: t.type, alias: `t${matched.length}` });
            }
          }
          if (matched.length) setSelectedTables(matched);
        }
      }

      setMsg(`✓ ${data.tables.length} tablas encontradas`);
      setTimeout(() => setMsg(''), 4000);
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setSchemaLoading(false); }
  };

  const estimateCost = async () => {
    if (!query.trim()) return;
    setEstimating(true); setCostWarnings([]);
    try {
      const connStr = currentConnString();
      const reqBody = connStr
        ? { dbType, connectionString: connStr, query }
        : { datasetId: initial.id, query };
      const { data } = await api.post('/datasets/db-connector/estimate', reqBody);
      setCostWarnings(data.warnings || []);
    } catch { /* silently fail */ }
    finally { setEstimating(false); }
  };

  const suggestedJoins = schema?.foreignKeys?.filter(fk =>
    selectedTables.some(t => t.name === fk.fromTable) && selectedTables.some(t => t.name === fk.toTable)
  ) || [];

  const buildQueryFromVisual = useCallback(async () => {
    if (!selectedTables.length || (!hasConnFields && !isEdit)) return;
    const completeJoins = joins.filter(j => j.leftTable && j.leftColumn && j.rightTable && j.rightColumn);
    if (selectedTables.length > 1 && !completeJoins.length) return;
    setBuildingQuery(true);
    try {
      const tables = selectedTables.map((t, i) => ({ name: t.name, schema: t.schema, alias: t.alias || `t${i}` }));
      const columns = [];
      for (const t of tables) {
        const cols = selectedColumns[t.name];
        if (cols?.length) {
          for (const c of cols) columns.push({ table: t.alias, column: c });
        }
      }
      const definition = { tables, columns, joins: completeJoins, limit: queryLimit };
      const connStr = currentConnString();
      const reqBody = connStr
        ? { dbType, connectionString: connStr, definition }
        : { datasetId: initial.id, definition };
      const { data } = await api.post('/datasets/db-connector/build-query', reqBody);
      setQuery(data.query);
      setCostWarnings([]);
    } catch (err) { setMsg(`Error SQL: ${err.response?.data?.error || err.message}`); }
    finally { setBuildingQuery(false); }
  }, [selectedTables, selectedColumns, joins, queryLimit, dbType, hasConnFields, currentConnString]);

  useEffect(() => {
    if (queryMode !== 'visual' || !selectedTables.length) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(buildQueryFromVisual, 500);
    return () => clearTimeout(debounceRef.current);
  }, [selectedTables, selectedColumns, joins, queryLimit, queryMode, buildQueryFromVisual]);

  const toggleTable = (t) => {
    setSelectedTables(prev => {
      const exists = prev.some(s => s.name === t.name);
      if (exists) {
        setSelectedColumns(cols => { const next = { ...cols }; delete next[t.name]; return next; });
        return prev.filter(s => s.name !== t.name);
      }
      return [...prev, { name: t.name, schema: t.schema, type: t.type, alias: `t${prev.length}` }];
    });
  };

  const toggleColumn = (tableName, colName) => {
    setSelectedColumns(prev => {
      const cols = prev[tableName] || [];
      return { ...prev, [tableName]: cols.includes(colName) ? cols.filter(c => c !== colName) : [...cols, colName] };
    });
  };

  const selectAllColumns = (t) => {
    setSelectedColumns(prev => ({ ...prev, [t.name]: t.columns.map(c => c.name) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (!isEdit && areas.length && !areaId) { setMsg('Selecciona un área'); setBusy(false); return; }

      const connStr = currentConnString();
      const visualDefinition = queryMode === 'visual' ? {
        tables: selectedTables,
        columns: Object.entries(selectedColumns).flatMap(([table, cols]) => {
          const t = selectedTables.find(s => s.name === table);
          return cols.map(c => ({ table: t?.alias || table, column: c }));
        }),
        joins,
        limit: queryLimit,
      } : undefined;

      const payload = { name, dbType, query, ...(!isEdit && { areaId }), ...(connStr && { connectionString: connStr }), ...(isSuperadmin && !isEdit && slotName.trim() && { slotName: slotName.trim() }), ...(visualDefinition && { visualDefinition }) };
      if (isEdit && !connStr) delete payload.connectionString;

      let data;
      if (isEdit) {
        ({ data } = await api.put(`/datasets/${initial.id}/db-connector`, payload));
        onSaved(data);
      } else {
        if (!connStr) { setMsg('Completa los datos de conexión'); setBusy(false); return; }
        if (!query.trim()) { setMsg('Genera o escribe una query primero'); setBusy(false); return; }
        ({ data } = await api.post('/datasets/db-connector', payload));
        const area = areas.find((a) => a.id === areaId);
        onCreated({ id: data.id, name: data.name, sourceType: 'db', slotName: data.slotName || null, config: data.config, _count: { rows: 0 }, area: area ? { id: area.id, name: area.name } : null });
        setName(''); setAreaId(''); setDbHost(''); setDbPort(DB_DEFAULTS[dbType]?.port || ''); setDbUser(''); setDbPass(''); setDbName(''); setQuery(''); setSlotName('');
        setSelectedTables([]); setSelectedColumns({}); setJoins([]); setSchema(null);
      }
      setMsg('✓ Conector guardado');
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!isEdit && (
        <>
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. DB Producción" className="field" />
          </Field>
          <AreaSelect areas={areas} value={areaId} onChange={setAreaId} />
          {isSuperadmin && (
            <Field label="Nombre de slot (opcional)"
              hint="Identifica esta fuente en plantillas base. Los clientes configurarán su propio connection string.">
              <input value={slotName} onChange={(e) => setSlotName(e.target.value)}
                placeholder="ej. produccion_db" className="field field-mono" />
            </Field>
          )}
        </>
      )}
      <Field label="Motor">
        <select value={dbType} onChange={(e) => handleDbTypeChange(e.target.value)} className="field">
          <option value="pg">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mssql">SQL Server</option>
          <option value="oracle">Oracle</option>
          <option value="redis">Redis</option>
        </select>
      </Field>

      <fieldset className="border border-line rounded-lg p-3 space-y-3">
        <legend className="text-xs font-semibold text-ink-soft px-1">
          {isEdit ? 'Conexión (dejar vacío para no cambiar)' : 'Datos de conexión'}
        </legend>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Servidor / IP">
            <input value={dbHost} onChange={(e) => setDbHost(e.target.value)}
              placeholder="ej. 192.168.1.100" className="field field-mono" />
          </Field>
          <Field label="Puerto">
            <input value={dbPort} onChange={(e) => setDbPort(e.target.value)}
              placeholder={DB_DEFAULTS[dbType]?.port} className="field field-mono w-24" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Usuario">
            <input value={dbUser} onChange={(e) => setDbUser(e.target.value)}
              placeholder="ej. lumina_user" className="field field-mono" autoComplete="off" />
          </Field>
          <Field label="Contraseña">
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={dbPass} onChange={(e) => setDbPass(e.target.value)}
                placeholder="••••••••" className="field field-mono pr-10" autoComplete="new-password" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-xs select-none">
                {showPass ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </Field>
        </div>
        {dbType !== 'redis' && (
          <Field label="Base de datos">
            <input value={dbName} onChange={(e) => setDbName(e.target.value)}
              placeholder={dbType === 'oracle' ? 'ej. ORCLPDB' : 'ej. lumina'} className="field field-mono" />
          </Field>
        )}
        <p className="text-[11px] text-ink-faint">Credenciales almacenadas cifradas con AES-256-GCM. Nunca visibles en texto plano.</p>
      </fieldset>

      {dbType !== 'redis' && (
        <div className="flex gap-1 bg-paper-deep rounded-lg p-1">
          <button type="button" onClick={() => setQueryMode('direct')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition ${queryMode === 'direct' ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink'}`}>
            Query directa
          </button>
          <button type="button" onClick={() => setQueryMode('visual')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition ${queryMode === 'visual' ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink'}`}>
            Constructor visual
          </button>
        </div>
      )}

      {queryMode === 'direct' || dbType === 'redis' ? (
        <Field
          label={dbType === 'redis' ? 'Comando Redis' : 'Query SQL'}
          hint={dbType === 'redis' ? 'Solo comandos de lectura: GET, HGETALL, LRANGE, SMEMBERS, KEYS, SCAN, etc.' : undefined}>
          <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3}
            placeholder={dbType === 'redis' ? 'HGETALL session:12345' : "SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '30 days'"}
            className="field field-mono resize-y" />
        </Field>
      ) : (
        <div className="space-y-3">
          <Button type="button" variant="soft" size="sm" onClick={loadSchema} disabled={schemaLoading || !canLoadSchema}>
            {schemaLoading ? (
              <><Icon name="refresh" size={13} className="animate-spin inline mr-1" />Cargando esquema…</>
            ) : schema ? (
              <><Icon name="refresh" size={13} className="inline mr-1" />Recargar esquema ({schema.tables.length} tablas)</>
            ) : (
              <><Icon name="database" size={13} className="inline mr-1" />Cargar esquema</>
            )}
          </Button>

          {schema && (
            <div className={schemaViewMode === 'diagram' ? 'space-y-3' : 'grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-3'}>
              <div className={`border border-line-soft rounded-xl bg-paper-deep/50 p-2 flex flex-col ${schemaViewMode === 'diagram' ? '' : 'max-h-[70vh]'}`} style={schemaViewMode === 'diagram' ? { height: '70vh', minHeight: 550 } : undefined}>
                <SchemaExplorer
                  schema={schema}
                  selectedTables={selectedTables}
                  selectedColumns={selectedColumns}
                  onToggleTable={toggleTable}
                  onToggleColumn={toggleColumn}
                  onSelectAllColumns={selectAllColumns}
                  onViewModeChange={setSchemaViewMode}
                />
              </div>
              <div className="space-y-3">
                <JoinBuilder
                  selectedTables={selectedTables}
                  schema={schema}
                  joins={joins}
                  onJoinsChange={setJoins}
                  suggestedJoins={suggestedJoins}
                />
                <QueryPreview
                  query={query}
                  warnings={costWarnings}
                  estimating={estimating}
                  onEstimate={estimateCost}
                  onApplyLimit={(n) => setQueryLimit(n)}
                />
                {queryLimit && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-ink-faint">LIMIT:</span>
                    <input type="number" value={queryLimit} onChange={(e) => setQueryLimit(Number(e.target.value) || null)}
                      className="field field-sm field-mono w-24" />
                    <button type="button" onClick={() => setQueryLimit(null)} className="text-rust text-xs hover:underline">Quitar</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Button type="submit" disabled={busy}>
        {busy ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear conector'}
      </Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}
    </form>
  );
}

// ── Dataset Derivado ──────────────────────────────────────────────────────────

const JOIN_OPS = [
  { value: 'inner', label: 'Inner Join' },
  { value: 'left', label: 'Left Join' },
];

const FILTER_OPS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'contains', label: 'contiene' },
];

const DERIVED_TUTORIAL_STEPS = [
  {
    icon: 'layers',
    title: 'Selecciona fuentes',
    desc: 'Elige uno o más datasets existentes (CSV, API, DB). Asigna un alias corto a cada uno para usarlo en joins.',
  },
  {
    icon: 'link',
    title: 'Define joins (si hay ≥ 2 fuentes)',
    desc: 'Une tablas por columnas en común, como un JOIN en SQL. Ejemplo: unir "clientes" con "pedidos" por cliente_id.',
  },
  {
    icon: 'hash',
    title: 'Agrega columnas calculadas',
    desc: 'Crea campos nuevos con expresiones simples: campo1 * campo2, campo1 + campo2. Útil para márgenes, totales, etc.',
  },
  {
    icon: 'filter',
    title: 'Filtra filas (opcional)',
    desc: 'Aplica condiciones para excluir filas. Ejemplo: solo pedidos donde estado = "entregado".',
  },
];

function DerivedDatasetForm({ onCreated, areas, availableDatasets, isSuperadmin = false }) {
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [sources, setSources] = useState([{ datasetId: '', alias: '' }]);
  const [joins, setJoins] = useState([]);
  const [calcCols, setCalcCols] = useState([{ name: '', expression: '' }]);
  const [rowFilters, setRowFilters] = useState([]);
  const [colsByDs, setColsByDs] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showTutorial, setShowTutorial] = useState(false);

  const csvDbs = availableDatasets.filter((d) => ['csv', 'api', 'db', 'derived'].includes(d.sourceType));

  // Carga columnas de un dataset cuando se selecciona como fuente
  const loadCols = async (datasetId) => {
    if (!datasetId || colsByDs[datasetId]) return;
    try {
      const { data } = await api.get(`/datasets/${datasetId}/columns`);
      setColsByDs((c) => ({ ...c, [datasetId]: data }));
    } catch { setColsByDs((c) => ({ ...c, [datasetId]: [] })); }
  };

  const updateSource = (i, field, val) => {
    const next = sources.map((s, j) => (j === i ? { ...s, [field]: val } : s));
    setSources(next);
    if (field === 'datasetId' && val) loadCols(val);
  };

  // Columnas de la primera fuente (para filtros y columnas calculadas)
  const allCols = sources.flatMap((s) => (colsByDs[s.datasetId] || []).map((c) => `${s.alias || s.datasetId}.${c}`));
  const firstCols = sources[0]?.datasetId ? (colsByDs[sources[0].datasetId] || []) : [];

  const runPreview = async (savedId) => {
    const id = savedId;
    if (!id) return;
    setPreviewLoading(true);
    try {
      const { data } = await api.get(`/datasets/${id}/derived/preview`);
      setPreview(data);
    } catch (err) {
      setMsg(`Error en preview: ${err.response?.data?.error || err.message}`);
    } finally { setPreviewLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setMsg('Ingresa un nombre');
    if (areas.length && !areaId) return setMsg('Selecciona un área');
    if (!sources[0]?.datasetId) return setMsg('Selecciona al menos un dataset fuente');
    setBusy(true); setMsg('');
    try {
      const payload = {
        name, areaId,
        sources: sources.filter((s) => s.datasetId).map((s) => ({
          datasetId: s.datasetId,
          alias: s.alias || s.datasetId,
        })),
        joins: joins.filter((j) => j.rightAlias && j.leftOn && j.rightOn),
        columns: calcCols.filter((c) => c.name.trim() && c.expression.trim()),
        filters: rowFilters.filter((f) => f.field && f.op && f.value !== ''),
      };
      const { data } = await api.post('/datasets/derived', payload);
      const area = areas.find((a) => a.id === areaId);
      onCreated({
        id: data.id, name: data.name, sourceType: 'derived',
        config: data.config, _count: { rows: 0 },
        area: area ? { id: area.id, name: area.name } : null,
      });
      await runPreview(data.id);
      setMsg('✓ Dataset derivado creado');
      setName(''); setAreaId(''); setSources([{ datasetId: '', alias: '' }]);
      setJoins([]); setCalcCols([{ name: '', expression: '' }]); setRowFilters([]);
      setPreview(null);
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Tutorial toggle */}
      <div>
        <button type="button" onClick={() => setShowTutorial((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
          <Icon name={showTutorial ? 'chevronDown' : 'chevronRight'} size={12} />
          {showTutorial ? 'Ocultar tutorial' : '¿Cómo funciona el Dataset Derivado?'}
        </button>
        {showTutorial && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-rise">
            {DERIVED_TUTORIAL_STEPS.map((step, i) => (
              <div key={i} className="flex gap-3 bg-paper-deep border border-line-soft rounded-xl p-3">
                <span className="grid place-items-center w-8 h-8 rounded-lg bg-lumen-soft text-lumen-deep shrink-0">
                  <Icon name={step.icon} size={15} />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink">{i + 1}. {step.title}</p>
                  <p className="text-[11px] text-ink-faint mt-0.5 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
            <div className="sm:col-span-2 bg-lumen-soft border border-lumen-line rounded-xl p-3">
              <p className="text-xs font-semibold text-lumen-deep mb-1">Ejemplo rápido</p>
              <p className="text-[11px] text-ink-soft font-mono leading-relaxed">
                Dataset A: <span className="text-ink">clientes</span> (id, nombre, ciudad)<br/>
                Dataset B: <span className="text-ink">pedidos</span> (cliente_id, monto, fecha)<br/>
                Join: clientes.id = pedidos.cliente_id<br/>
                Columna calculada: <span className="text-ink">iva = monto * 0.16</span><br/>
                Resultado: una tabla con nombre, ciudad, monto e IVA por pedido.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Nombre + área */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre del dataset derivado">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Ventas + Clientes" className="field" />
        </Field>
        <AreaSelect areas={areas} value={areaId} onChange={setAreaId} />
      </div>

      {/* Fuentes */}
      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Datasets fuente</p>
        <div className="space-y-2">
          {sources.map((src, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select className="field field-sm flex-1"
                value={src.datasetId}
                onChange={(e) => updateSource(i, 'datasetId', e.target.value)}>
                <option value="">— Seleccionar dataset —</option>
                {csvDbs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <input className="field field-sm field-mono w-32" placeholder="alias"
                value={src.alias}
                onChange={(e) => updateSource(i, 'alias', e.target.value)} />
              {sources.length > 1 && (
                <button type="button" onClick={() => setSources(sources.filter((_, j) => j !== i))}
                  className="text-ink-faint hover:text-rust cursor-pointer">
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setSources([...sources, { datasetId: '', alias: '' }])}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
          <Icon name="plus" size={12} /> Agregar fuente
        </button>
      </div>

      {/* Joins (solo si hay ≥2 fuentes con dataset) */}
      {sources.filter((s) => s.datasetId).length >= 2 && (
        <div>
          <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Joins</p>
          <div className="space-y-2">
            {joins.map((j, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center bg-paper-deep rounded-lg p-2">
                <select className="field field-sm flex-1 min-w-[120px]" value={j.leftAlias || ''}
                  onChange={(e) => setJoins(joins.map((x, k) => k === i ? { ...x, leftAlias: e.target.value } : x))}>
                  <option value="">— Tabla izq —</option>
                  {sources.filter((s) => s.datasetId).map((s) => (
                    <option key={s.datasetId} value={s.alias || s.datasetId}>{s.alias || s.name || s.datasetId}</option>
                  ))}
                </select>
                <select className="field field-sm flex-1 min-w-[120px]" value={j.leftOn || ''}
                  onChange={(e) => setJoins(joins.map((x, k) => k === i ? { ...x, leftOn: e.target.value } : x))}>
                  <option value="">— Col. izq —</option>
                  {(colsByDs[sources.find((s) => (s.alias || s.datasetId) === j.leftAlias)?.datasetId] || []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span className="text-xs text-ink-faint">=</span>
                <select className="field field-sm flex-1 min-w-[120px]" value={j.rightAlias || ''}
                  onChange={(e) => setJoins(joins.map((x, k) => k === i ? { ...x, rightAlias: e.target.value } : x))}>
                  <option value="">— Tabla der —</option>
                  {sources.filter((s) => s.datasetId).map((s) => (
                    <option key={s.datasetId} value={s.alias || s.datasetId}>{s.alias || s.name || s.datasetId}</option>
                  ))}
                </select>
                <select className="field field-sm flex-1 min-w-[120px]" value={j.rightOn || ''}
                  onChange={(e) => setJoins(joins.map((x, k) => k === i ? { ...x, rightOn: e.target.value } : x))}>
                  <option value="">— Col. der —</option>
                  {(colsByDs[sources.find((s) => (s.alias || s.datasetId) === j.rightAlias)?.datasetId] || []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setJoins(joins.filter((_, k) => k !== i))}
                  className="text-ink-faint hover:text-rust cursor-pointer">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button"
            onClick={() => setJoins([...joins, { leftAlias: '', leftOn: '', rightAlias: '', rightOn: '' }])}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
            <Icon name="plus" size={12} /> Agregar join
          </button>
        </div>
      )}

      {/* Columnas calculadas */}
      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Columnas calculadas</p>
        <div className="space-y-2">
          {calcCols.map((col, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input className="field field-sm field-mono w-36" placeholder="nombre_col"
                value={col.name}
                onChange={(e) => setCalcCols(calcCols.map((c, j) => j === i ? { ...c, name: e.target.value } : c))} />
              <span className="text-xs text-ink-faint">=</span>
              <input className="field field-sm field-mono flex-1" placeholder="campo1 * campo2"
                value={col.expression}
                onChange={(e) => setCalcCols(calcCols.map((c, j) => j === i ? { ...c, expression: e.target.value } : c))} />
              {calcCols.length > 1 && (
                <button type="button" onClick={() => setCalcCols(calcCols.filter((_, j) => j !== i))}
                  className="text-ink-faint hover:text-rust cursor-pointer">
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {firstCols.length > 0 && (
          <p className="text-[11px] text-ink-faint font-mono mt-1">
            Campos disponibles: {firstCols.slice(0, 10).join(', ')}{firstCols.length > 10 ? '…' : ''}
          </p>
        )}
        <button type="button" onClick={() => setCalcCols([...calcCols, { name: '', expression: '' }])}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
          <Icon name="plus" size={12} /> Agregar columna
        </button>
      </div>

      {/* Filtros de filas */}
      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Filtros de filas (opcional)</p>
        <div className="space-y-2">
          {rowFilters.map((f, i) => (
            <div key={i} className="flex gap-2 items-center flex-wrap">
              <select className="field field-sm flex-1 min-w-[140px]" value={f.field}
                onChange={(e) => setRowFilters(rowFilters.map((x, k) => k === i ? { ...x, field: e.target.value } : x))}>
                <option value="">— Campo —</option>
                {firstCols.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="field field-sm w-24" value={f.op}
                onChange={(e) => setRowFilters(rowFilters.map((x, k) => k === i ? { ...x, op: e.target.value } : x))}>
                {FILTER_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
              <input className="field field-sm field-mono flex-1 min-w-[100px]" placeholder="valor"
                value={f.value}
                onChange={(e) => setRowFilters(rowFilters.map((x, k) => k === i ? { ...x, value: e.target.value } : x))} />
              <button type="button" onClick={() => setRowFilters(rowFilters.filter((_, k) => k !== i))}
                className="text-ink-faint hover:text-rust cursor-pointer">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button"
          onClick={() => setRowFilters([...rowFilters, { field: '', op: 'eq', value: '' }])}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
          <Icon name="plus" size={12} /> Agregar filtro
        </button>
      </div>

      <Button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear dataset derivado'}</Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}

      {/* Vista previa */}
      {(preview || previewLoading) && (
        <div className="border border-line-soft rounded-xl overflow-hidden mt-2">
          <div className="flex items-center justify-between px-3 py-2 bg-paper-deep border-b border-line-soft">
            <p className="text-xs font-semibold text-ink-soft">
              Vista previa {preview ? `· ${preview.total} filas (mostrando ${preview.rows?.length})` : ''}
            </p>
            {previewLoading && <span className="text-xs text-ink-faint font-mono animate-pulse">Calculando…</span>}
          </div>
          {preview?.rows?.length > 0 && (
            <div className="overflow-auto max-h-56">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>{Object.keys(preview.rows[0]).map((c) => (
                    <th key={c} className="text-left px-2.5 py-1.5 bg-paper border-b border-line font-mono font-medium text-ink-soft whitespace-nowrap sticky top-0">{c}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className={i % 2 ? 'bg-paper/60' : ''}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-2.5 py-1 border-b border-line-soft text-ink-soft font-mono max-w-[180px] truncate">
                          {v !== null && v !== undefined ? String(v) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

// ── Editor de dataset derivado existente ─────────────────────────────────────

function DerivedDatasetEditor({ dataset, areas, availableDatasets, onSaved }) {
  const cfg = dataset.config || {};
  const [name, setName] = useState(dataset.name);
  const [sources, setSources] = useState(cfg.sources || [{ datasetId: '', alias: '' }]);
  const [joins, setJoins] = useState(cfg.joins || []);
  const [calcCols, setCalcCols] = useState(cfg.columns?.length ? cfg.columns : [{ name: '', expression: '' }]);
  const [rowFilters, setRowFilters] = useState(cfg.filters || []);
  const [colsByDs, setColsByDs] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const csvDbs = availableDatasets.filter((d) => d.id !== dataset.id && ['csv', 'api', 'db', 'derived'].includes(d.sourceType));

  useEffect(() => {
    sources.forEach((s) => {
      if (s.datasetId && !colsByDs[s.datasetId]) {
        api.get(`/datasets/${s.datasetId}/columns`).then(({ data }) =>
          setColsByDs((c) => ({ ...c, [s.datasetId]: data }))
        ).catch(() => {});
      }
    });
  }, [sources]);

  const updateSource = (i, field, val) => {
    const next = sources.map((s, j) => (j === i ? { ...s, [field]: val } : s));
    setSources(next);
    if (field === 'datasetId' && val && !colsByDs[val]) {
      api.get(`/datasets/${val}/columns`).then(({ data }) =>
        setColsByDs((c) => ({ ...c, [val]: data }))
      ).catch(() => {});
    }
  };

  const firstCols = sources[0]?.datasetId ? (colsByDs[sources[0].datasetId] || []) : [];

  const runPreview = async () => {
    setPreviewLoading(true);
    try {
      const { data } = await api.get(`/datasets/${dataset.id}/derived/preview`);
      setPreview(data);
    } catch (err) {
      setMsg(`Error en preview: ${err.response?.data?.error || err.message}`);
    } finally { setPreviewLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const payload = {
        name,
        sources: sources.filter((s) => s.datasetId).map((s) => ({ datasetId: s.datasetId, alias: s.alias || s.datasetId })),
        joins: joins.filter((j) => j.rightAlias && j.leftOn && j.rightOn),
        columns: calcCols.filter((c) => c.name.trim() && c.expression.trim()),
        filters: rowFilters.filter((f) => f.field && f.op && f.value !== ''),
      };
      const { data } = await api.put(`/datasets/${dataset.id}/derived`, payload);
      onSaved(data);
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} className="field" />
      </Field>

      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Datasets fuente</p>
        <div className="space-y-2">
          {sources.map((src, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select className="field field-sm flex-1" value={src.datasetId}
                onChange={(e) => updateSource(i, 'datasetId', e.target.value)}>
                <option value="">— Seleccionar dataset —</option>
                {csvDbs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <input className="field field-sm field-mono w-32" placeholder="alias" value={src.alias}
                onChange={(e) => updateSource(i, 'alias', e.target.value)} />
              {sources.length > 1 && (
                <button type="button" onClick={() => setSources(sources.filter((_, j) => j !== i))}
                  className="text-ink-faint hover:text-rust cursor-pointer"><Icon name="x" size={14} /></button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setSources([...sources, { datasetId: '', alias: '' }])}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
          <Icon name="plus" size={12} /> Agregar fuente
        </button>
      </div>

      <div>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Columnas calculadas</p>
        <div className="space-y-2">
          {calcCols.map((col, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input className="field field-sm field-mono w-36" placeholder="nombre" value={col.name}
                onChange={(e) => setCalcCols(calcCols.map((c, j) => j === i ? { ...c, name: e.target.value } : c))} />
              <span className="text-xs text-ink-faint">=</span>
              <input className="field field-sm field-mono flex-1" placeholder="campo1 * campo2" value={col.expression}
                onChange={(e) => setCalcCols(calcCols.map((c, j) => j === i ? { ...c, expression: e.target.value } : c))} />
              {calcCols.length > 1 && (
                <button type="button" onClick={() => setCalcCols(calcCols.filter((_, j) => j !== i))}
                  className="text-ink-faint hover:text-rust cursor-pointer"><Icon name="x" size={14} /></button>
              )}
            </div>
          ))}
        </div>
        {firstCols.length > 0 && (
          <p className="text-[11px] text-ink-faint font-mono mt-1">Campos: {firstCols.slice(0, 10).join(', ')}</p>
        )}
        <button type="button" onClick={() => setCalcCols([...calcCols, { name: '', expression: '' }])}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-lumen-deep font-medium hover:underline cursor-pointer">
          <Icon name="plus" size={12} /> Agregar columna
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</Button>
        <Button type="button" variant="soft" disabled={previewLoading} onClick={runPreview}>
          {previewLoading ? 'Calculando…' : 'Vista previa'}
        </Button>
      </div>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}

      {preview?.rows?.length > 0 && (
        <div className="border border-line-soft rounded-xl overflow-hidden">
          <p className="text-xs font-semibold text-ink-soft px-3 py-2 bg-paper-deep border-b border-line-soft">
            {preview.total} filas · mostrando {preview.rows.length}
          </p>
          <div className="overflow-auto max-h-48">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>{Object.keys(preview.rows[0]).map((c) => (
                  <th key={c} className="text-left px-2.5 py-1.5 bg-paper border-b border-line font-mono font-medium text-ink-soft whitespace-nowrap sticky top-0">{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className={i % 2 ? 'bg-paper/60' : ''}>
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-2.5 py-1 border-b border-line-soft text-ink-soft font-mono max-w-[160px] truncate">
                        {v !== null && v !== undefined ? String(v) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </form>
  );
}
