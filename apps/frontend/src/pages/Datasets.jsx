import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const SOURCE_LABELS = { csv: 'CSV / Excel', api: 'API', db: 'Base de datos' };
const SOURCE_ICONS = { csv: '📄', api: '🌐', db: '🗄️' };

export default function Datasets() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('csv'); // csv | api | db
  const [preview, setPreview] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // dataset to edit
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get('/datasets').then(({ data }) => { setDatasets(data); setLoading(false); });
  }, []);

  const addDataset = (ds) => setDatasets((prev) => [ds, ...prev]);
  const replaceDataset = (ds) => setDatasets((prev) => prev.map((d) => (d.id === ds.id ? ds : d)));

  const deleteDataset = async (id) => {
    if (!confirm('¿Eliminar este dataset?')) return;
    await api.delete(`/datasets/${id}`);
    setDatasets((d) => d.filter((x) => x.id !== id));
    if (preview?.id === id) setPreview(null);
  };

  const loadPreview = async (ds) => {
    const { data } = await api.get(`/datasets/${ds.id}/rows`);
    setPreview({ ...ds, rows: data.slice(0, 20) });
  };

  const syncDataset = async (ds) => {
    setStatus(`Sincronizando "${ds.name}"...`);
    try {
      const { data } = await api.post(`/datasets/${ds.id}/fetch`);
      setStatus(`✓ ${data.count} filas cargadas`);
      setDatasets((prev) => prev.map((d) => d.id === ds.id ? { ...d, _count: { rows: data.count } } : d));
    } catch (err) {
      setStatus(`Error: ${err.response?.data?.error || err.message}`);
    }
    setTimeout(() => setStatus(''), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <Link to="/" className="text-slate-500 hover:text-slate-800 text-sm">← Dashboard</Link>
        <span className="text-slate-300">|</span>
        <h1 className="text-lg font-bold text-slate-800">Datasets</h1>
        {status && <span className="ml-auto text-sm text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{status}</span>}
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* New connector form */}
        <div className="bg-white border border-slate-200 rounded-xl mb-6 overflow-hidden">
          <div className="flex border-b border-slate-100">
            {['csv', 'api', 'db'].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium transition ${tab === t ? 'border-b-2 border-indigo-500 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>
                {SOURCE_ICONS[t]} {SOURCE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="p-5">
            {tab === 'csv' && <CSVForm onCreated={addDataset} />}
            {tab === 'api' && <APIForm onCreated={addDataset} />}
            {tab === 'db' && <DBForm onCreated={addDataset} />}
          </div>
        </div>

        {/* Dataset list */}
        {loading ? (
          <p className="text-slate-500 text-sm">Cargando...</p>
        ) : datasets.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-2">📂</p>
            <p>No hay datasets. Crea uno arriba.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {datasets.map((ds) => (
              <DatasetCard key={ds.id} ds={ds}
                onDelete={deleteDataset}
                onPreview={loadPreview}
                onSync={syncDataset}
                onEdit={() => setEditTarget(ds)}
              />
            ))}
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">Vista previa: {preview.name}</h2>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            {preview.rows?.length ? (
              <div className="overflow-auto max-h-72">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>{Object.keys(preview.rows[0]).map((c) => (
                      <th key={c} className="text-left px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 whitespace-nowrap sticky top-0">{c}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 border-b border-slate-100 text-slate-700 max-w-[200px] truncate">{String(v ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-slate-400 text-sm">Sin datos — usa "Sincronizar" para cargar.</p>}
          </div>
        )}

        {/* Edit modal */}
        {editTarget && (
          <EditModal ds={editTarget} onClose={() => setEditTarget(null)}
            onSaved={(updated) => { replaceDataset(updated); setEditTarget(null); }} />
        )}
      </main>
    </div>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

function DatasetCard({ ds, onDelete, onPreview, onSync, onEdit }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{SOURCE_ICONS[ds.sourceType] || '📦'}</span>
          <div>
            <p className="font-semibold text-slate-800 text-sm">{ds.name}</p>
            <p className="text-xs text-slate-400">{SOURCE_LABELS[ds.sourceType]} · {ds._count?.rows ?? 0} filas</p>
          </div>
        </div>
      </div>

      {ds.sourceType === 'api' && ds.config?.url && (
        <p className="text-xs text-slate-400 truncate mb-2">
          <span className="font-mono bg-slate-50 px-1 rounded">{ds.config.method || 'GET'}</span>{' '}
          {ds.config.url}
        </p>
      )}
      {ds.sourceType === 'db' && ds.config?.dbType && (
        <p className="text-xs text-slate-400 mb-2">
          <span className="font-mono bg-slate-50 px-1 rounded">{ds.config.dbType}</span>{' '}
          <span className="text-slate-300">· query configurado</span>
        </p>
      )}

      <div className="flex gap-1 mt-2 flex-wrap">
        <button onClick={() => onPreview(ds)} className="text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg px-2 py-1 transition">Vista previa</button>
        {['api', 'db'].includes(ds.sourceType) && (
          <button onClick={() => onSync(ds)} className="text-xs text-emerald-600 hover:bg-emerald-50 rounded-lg px-2 py-1 transition">Sincronizar</button>
        )}
        {['api', 'db'].includes(ds.sourceType) && (
          <button onClick={() => onEdit(ds)} className="text-xs text-slate-600 hover:bg-slate-100 rounded-lg px-2 py-1 transition">Editar</button>
        )}
        <button onClick={() => onDelete(ds.id)} className="text-xs text-red-500 hover:bg-red-50 rounded-lg px-2 py-1 transition ml-auto">Eliminar</button>
      </div>
    </div>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────

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
      <Row label="Nombre"><Input value={name} onChange={setName} placeholder="ej. Ventas 2024" /></Row>
      <Row label="Archivo">
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.ods"
          className="text-sm text-slate-600 file:mr-3 file:text-xs file:bg-indigo-50 file:text-indigo-600 file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:cursor-pointer" />
      </Row>
      <SubmitBtn busy={busy} label="Subir archivo" />
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
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
      {!isEdit && <Row label="Nombre"><Input value={name} onChange={setName} placeholder="ej. API de clientes" /></Row>}
      <div className="flex gap-2">
        <div className="w-24">
          <label className="block text-xs font-medium text-slate-600 mb-1">Método</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
            {['GET', 'POST', 'PUT'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <Row label="URL"><Input value={url} onChange={setUrl} placeholder="https://api.example.com/data" /></Row>
        </div>
      </div>
      <Row label="Data path (opcional)">
        <Input value={dataPath} onChange={setDataPath} placeholder="ej. data.results" />
      </Row>
      <Row label="Headers JSON (opcional — incluye API keys aquí)">
        <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3}
          placeholder={'{\n  "Authorization": "Bearer TOKEN"\n}'}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        <p className="text-xs text-amber-600 mt-0.5">Los headers se almacenan cifrados con AES-256-GCM.</p>
      </Row>
      <Row label="Body JSON (opcional)">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
          placeholder="{}"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400" />
      </Row>
      <SubmitBtn busy={busy} label={isEdit ? 'Guardar cambios' : 'Crear conector'} />
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
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
      {!isEdit && <Row label="Nombre"><Input value={name} onChange={setName} placeholder="ej. DB Producción" /></Row>}
      <Row label="Motor">
        <select value={dbType} onChange={(e) => setDbType(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="pg">PostgreSQL</option>
          <option value="mysql">MySQL</option>
        </select>
      </Row>
      <Row label={isEdit ? 'Connection string (dejar vacío para no cambiar)' : 'Connection string'}>
        <input type="password" value={connStr} onChange={(e) => setConnStr(e.target.value)}
          placeholder="postgresql://user:password@host:5432/dbname"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        <p className="text-xs text-amber-600 mt-0.5">Almacenado cifrado con AES-256-GCM. Nunca visible en texto plano.</p>
      </Row>
      <Row label="Query SQL">
        <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3}
          placeholder="SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '30 days'"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400" />
      </Row>
      <SubmitBtn busy={busy} label={isEdit ? 'Guardar cambios' : 'Crear conector'} />
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </form>
  );
}

// ── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ ds, onClose, onSaved }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Editar conector: {ds.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <div className="p-5">
          {ds.sourceType === 'api' && <APIForm initial={ds} onCreated={() => {}} onSaved={onSaved} />}
          {ds.sourceType === 'db' && <DBForm initial={ds} onCreated={() => {}} onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Row({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
  );
}

function SubmitBtn({ busy, label }) {
  return (
    <button type="submit" disabled={busy}
      className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50">
      {busy ? 'Guardando...' : label}
    </button>
  );
}
