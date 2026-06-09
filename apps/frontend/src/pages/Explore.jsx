import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

export default function Explore() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const load = async (query = '') => {
    setSearching(true);
    const { data } = await api.get('/reports/explore', { params: query ? { q: query } : {} });
    setReports(data);
    setLoading(false);
    setSearching(false);
  };

  useEffect(() => { load(); }, []);

  const search = (e) => {
    e.preventDefault();
    load(q);
  };

  const toggleFavorite = async (r) => {
    const { data } = await api.post(`/reports/${r.id}/favorite`);
    setReports((prev) => prev.map((x) => x.id === r.id ? { ...x, isFavorited: data.isFavorited } : x));
  };

  const duplicate = async (r) => {
    const { data } = await api.post(`/reports/${r.id}/duplicate`);
    navigate(`/report/${data.id}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <Link to="/" className="text-slate-500 hover:text-slate-800 text-sm">← Dashboard</Link>
        <span className="text-slate-300">|</span>
        <h1 className="text-lg font-bold text-slate-800">Explorar reportes públicos</h1>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <form onSubmit={search} className="flex gap-3 mb-8">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre..."
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <button type="submit" disabled={searching}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50">
            Buscar
          </button>
        </form>

        {loading ? (
          <p className="text-slate-500 text-sm">Cargando...</p>
        ) : reports.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm">No se encontraron reportes públicos{q && ` para "${q}"`}.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reports.map((r) => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-800 truncate">{r.title}</h3>
                    {r.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{r.description}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">por {r.owner?.name}</p>
                  </div>
                  <button onClick={() => toggleFavorite(r)}
                    className={`ml-2 text-lg flex-shrink-0 transition ${r.isFavorited ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}>
                    ★
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-4 text-xs text-slate-400">
                  <span>{r._count?.widgets ?? 0} widgets</span>
                  <span className="text-slate-300">·</span>
                  <span>{r._count?.favoritedBy ?? 0} ★</span>
                  <span className="text-slate-300">·</span>
                  <span>{new Date(r.updatedAt).toLocaleDateString()}</span>
                </div>

                <div className="flex gap-2 mt-auto">
                  <Link to={`/report/${r.id}`}
                    className="flex-1 text-center text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg py-1.5 font-medium transition">
                    Ver reporte
                  </Link>
                  <button onClick={() => duplicate(r)}
                    className="text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition" title="Copiar a mis reportes">
                    Copiar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
