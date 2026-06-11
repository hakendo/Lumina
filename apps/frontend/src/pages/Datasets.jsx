import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';
import { invalidateDatasetCache } from '../lib/datasetCache';
import { AppHeader, Button, ConfirmModal, EmptyState, Field, Icon, Modal, SkeletonCards } from '../components/ui';

const SOURCES = {
  csv: { label: 'CSV / Excel', icon: 'file' },
  api: { label: 'API', icon: 'globe' },
  db: { label: 'Base de datos', icon: 'database' },
};

export default function Datasets() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('csv'); // csv | api | db
  const [preview, setPreview] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get('/datasets')
      .then(({ data }) => setDatasets(data))
      .catch(() => setLoadError('No se pudieron cargar los datasets.'))
      .finally(() => setLoading(false));
  }, []);

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
    setStatus(`Sincronizando "${ds.name}"…`);
    try {
      const { data } = await api.post(`/datasets/${ds.id}/fetch`);
      invalidateDatasetCache(ds.id);
      setStatus(`✓ ${data.count} filas cargadas`);
      setDatasets((prev) => prev.map((d) => d.id === ds.id ? { ...d, _count: { rows: data.count } } : d));
    } catch (err) {
      setStatus(`Error: ${err.response?.data?.error || err.message}`);
    }
    setTimeout(() => setStatus(''), 4000);
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
          {status && (
            <span className="text-sm text-lumen-deep bg-lumen-soft px-3 py-1.5 rounded-full font-mono text-xs">
              {status}
            </span>
          )}
        </div>

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
            {tab === 'csv' && <CSVForm onCreated={addDataset} />}
            {tab === 'api' && <APIForm onCreated={addDataset} />}
            {tab === 'db' && <DBForm onCreated={addDataset} />}
          </div>
        </div>

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
          <Modal title={`Editar conector · ${editTarget.name}`} onClose={() => setEditTarget(null)}>
            {editTarget.sourceType === 'api' && (
              <APIForm initial={editTarget} onCreated={() => {}}
                onSaved={(updated) => { replaceDataset(updated); setEditTarget(null); }} />
            )}
            {editTarget.sourceType === 'db' && (
              <DBForm initial={editTarget} onCreated={() => {}}
                onSaved={(updated) => { replaceDataset(updated); setEditTarget(null); }} />
            )}
          </Modal>
        )}
      </main>
    </div>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

function DatasetCard({ ds, index, onDelete, onPreview, onSync, onEdit }) {
  const source = SOURCES[ds.sourceType] || { label: ds.sourceType, icon: 'database' };
  const editable = ['api', 'db'].includes(ds.sourceType);

  return (
    <div className="bg-surface border border-line-soft rounded-xl p-4 shadow-card hover:shadow-lift hover:border-lumen-line transition animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
      <div className="flex items-center gap-3 mb-2">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-lumen-soft text-lumen-deep shrink-0">
          <Icon name={source.icon} size={17} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm text-ink truncate">{ds.name}</p>
          <p className="font-mono text-[11px] text-ink-faint">
            {source.label} · {ds._count?.rows ?? 0} filas
          </p>
        </div>
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

      <div className="flex gap-1 mt-2 flex-wrap">
        <CardBtn icon="eye" label="Vista previa" onClick={() => onPreview(ds)} />
        {editable && <CardBtn icon="refresh" label="Sincronizar" accent onClick={() => onSync(ds)} />}
        {editable && <CardBtn icon="pencil" label="Editar" onClick={onEdit} />}
        <button onClick={() => onDelete(ds)} title="Eliminar"
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint hover:text-rust hover:bg-rust-soft rounded-lg px-2 py-1 transition cursor-pointer">
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}

function CardBtn({ icon, label, onClick, accent = false }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 transition cursor-pointer ${
        accent ? 'text-sea hover:bg-sea-soft' : 'text-ink-soft hover:bg-paper-deep hover:text-ink'
      }`}>
      <Icon name={icon} size={13} /> {label}
    </button>
  );
}

// ── Formularios ──────────────────────────────────────────────────────────────

function CSVForm({ onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();

  const submit = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files[0];
    if (!file) return setMsg('Selecciona un archivo');
    if (!name.trim()) return setMsg('Ingresa un nombre');
    setBusy(true); setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name);
      const { data } = await api.post('/datasets/upload', form);
      onCreated({ id: data.id, name: data.name, sourceType: 'csv', config: {}, _count: { rows: data.count } });
      setName(''); fileRef.current.value = '';
      setMsg(`✓ ${data.count} filas importadas`);
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Ventas 2024" className="field" />
      </Field>
      <Field label="Archivo">
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.ods"
          className="text-sm text-ink-soft file:mr-3 file:text-xs file:bg-lumen-soft file:text-lumen-deep file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:cursor-pointer file:font-medium" />
      </Field>
      <Button type="submit" disabled={busy}>{busy ? 'Subiendo…' : 'Subir archivo'}</Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}
    </form>
  );
}

function APIForm({ onCreated, initial = {}, onSaved }) {
  const isEdit = !!onSaved;
  const [name, setName] = useState(initial.name || '');
  const [url, setUrl] = useState(initial.config?.url || '');
  const [method, setMethod] = useState(initial.config?.method || 'GET');
  const [dataPath, setDataPath] = useState(initial.config?.dataPath || '');
  const [headers, setHeaders] = useState(
    initial.config?.headers ? JSON.stringify(initial.config.headers, null, 2) : ''
  );
  const [body, setBody] = useState(
    initial.config?.body ? JSON.stringify(initial.config.body, null, 2) : ''
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const parseJSON = (str, label) => {
    if (!str.trim()) return {};
    try { return JSON.parse(str); }
    catch { throw new Error(`${label}: JSON inválido`); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const payload = {
        name, url, method, dataPath,
        headers: parseJSON(headers, 'Headers'),
        body: body.trim() ? parseJSON(body, 'Body') : null,
      };
      let data;
      if (isEdit) {
        ({ data } = await api.put(`/datasets/${initial.id}/api-connector`, payload));
        onSaved(data);
      } else {
        ({ data } = await api.post('/datasets/api-connector', payload));
        onCreated({ id: data.id, name: data.name, sourceType: 'api', config: data.config, _count: { rows: 0 } });
        setName(''); setUrl(''); setHeaders(''); setBody(''); setDataPath('');
      }
      setMsg('✓ Conector guardado');
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!isEdit && (
        <Field label="Nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. API de clientes" className="field" />
        </Field>
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
      <Field label="Data path (opcional)">
        <input value={dataPath} onChange={(e) => setDataPath(e.target.value)} placeholder="ej. data.results" className="field field-mono" />
      </Field>
      <Field label="Headers JSON (opcional — incluye API keys aquí)"
        hint="Los headers se almacenan cifrados con AES-256-GCM.">
        <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3}
          placeholder={'{\n  "Authorization": "Bearer TOKEN"\n}'}
          className="field field-mono resize-y" />
      </Field>
      <Field label="Body JSON (opcional)">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
          placeholder="{}" className="field field-mono resize-y" />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear conector'}
      </Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}
    </form>
  );
}

function DBForm({ onCreated, initial = {}, onSaved }) {
  const isEdit = !!onSaved;
  const [name, setName] = useState(initial.name || '');
  const [dbType, setDbType] = useState(initial.config?.dbType || 'pg');
  const [connStr, setConnStr] = useState('');
  const [query, setQuery] = useState(initial.config?.query || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const payload = { name, dbType, query, ...(connStr.trim() && { connectionString: connStr }) };
      if (isEdit && !connStr.trim()) delete payload.connectionString;

      let data;
      if (isEdit) {
        ({ data } = await api.put(`/datasets/${initial.id}/db-connector`, payload));
        onSaved(data);
      } else {
        if (!connStr.trim()) { setMsg('El connection string es requerido'); setBusy(false); return; }
        ({ data } = await api.post('/datasets/db-connector', payload));
        onCreated({ id: data.id, name: data.name, sourceType: 'db', config: data.config, _count: { rows: 0 } });
        setName(''); setConnStr(''); setQuery('');
      }
      setMsg('✓ Conector guardado');
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!isEdit && (
        <Field label="Nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. DB Producción" className="field" />
        </Field>
      )}
      <Field label="Motor">
        <select value={dbType} onChange={(e) => setDbType(e.target.value)} className="field">
          <option value="pg">PostgreSQL</option>
          <option value="mysql">MySQL</option>
        </select>
      </Field>
      <Field label={isEdit ? 'Connection string (dejar vacío para no cambiar)' : 'Connection string'}
        hint="Almacenado cifrado con AES-256-GCM. Nunca visible en texto plano.">
        <input type="password" value={connStr} onChange={(e) => setConnStr(e.target.value)}
          placeholder="postgresql://user:password@host:5432/dbname" className="field field-mono" />
      </Field>
      <Field label="Query SQL">
        <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3}
          placeholder="SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '30 days'"
          className="field field-mono resize-y" />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear conector'}
      </Button>
      {msg && <p className="text-xs text-ink-faint font-mono">{msg}</p>}
    </form>
  );
}
