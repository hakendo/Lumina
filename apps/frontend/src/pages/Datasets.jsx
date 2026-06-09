import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function Datasets() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [newName, setNewName] = useState('');
  const [preview, setPreview] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    api.get('/datasets').then(({ data }) => { setDatasets(data); setLoading(false); });
  }, []);

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !newName.trim()) return alert('Ingresa un nombre para el dataset');
    setUploading('creating');
    const { data: ds } = await api.post('/datasets', { name: newName, sourceType: 'csv' });
    setUploading('uploading');
    const form = new FormData();
    form.append('file', file);
    const { data: result } = await api.post(`/datasets/${ds.id}/upload`, form);
    setDatasets((prev) => [...prev, { ...ds, _count: { rows: result.count } }]);
    setNewName('');
    setUploading(null);
    fileRef.current.value = '';
  };

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <Link to="/" className="text-slate-500 hover:text-slate-800 text-sm">← Dashboard</Link>
        <span className="text-slate-300">|</span>
        <h1 className="text-lg font-bold text-slate-800">Datasets</h1>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Upload */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Subir CSV o Excel</h2>
          <div className="flex gap-3 flex-wrap">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del dataset" className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <input type="file" ref={fileRef} onChange={uploadFile} accept=".csv,.xlsx,.xls,.ods"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm cursor-pointer" />
          </div>
          {uploading && <p className="text-xs text-slate-500 mt-2">{uploading === 'creating' ? 'Creando dataset...' : 'Subiendo archivo...'}</p>}
        </div>

        {/* List */}
        {loading ? <p className="text-slate-500 text-sm">Cargando...</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {datasets.map((ds) => (
              <div key={ds.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{ds.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{ds._count?.rows ?? 0} filas · {ds.sourceType}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => loadPreview(ds)} className="text-xs text-indigo-600 hover:underline px-2 py-1">Vista previa</button>
                    <button onClick={() => deleteDataset(ds.id)} className="text-xs text-red-500 hover:bg-red-50 rounded px-2 py-1">✕</button>
                  </div>
                </div>
              </div>
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
              <div className="overflow-auto">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>{Object.keys(preview.rows[0]).map((c) => (
                      <th key={c} className="text-left px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 whitespace-nowrap">{c}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 border-b border-slate-100 text-slate-700 max-w-[200px] truncate">{String(v ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-slate-400 text-sm">Sin datos</p>}
          </div>
        )}
      </main>
    </div>
  );
}
