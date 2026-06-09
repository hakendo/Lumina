import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

export default function Dashboard() {
  const { user, logout } = useAuthStore();
  const [reports, setReports] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('mine'); // mine | favorites
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/reports'),
      api.get('/reports/favorites'),
    ]).then(([r, f]) => {
      setReports(r.data);
      setFavorites(f.data);
      setLoading(false);
    });
  }, []);

  const createReport = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    const { data } = await api.post('/reports', { title: newTitle });
    setNewTitle('');
    setCreating(false);
    navigate(`/report/${data.id}`);
  };

  const deleteReport = async (id) => {
    if (!confirm('¿Eliminar este reporte?')) return;
    await api.delete(`/reports/${id}`);
    setReports((r) => r.filter((x) => x.id !== id));
  };

  const duplicateReport = async (r) => {
    const { data } = await api.post(`/reports/${r.id}/duplicate`);
    setReports((prev) => [data, ...prev]);
  };

  const toggleFavorite = async (r) => {
    const { data } = await api.post(`/reports/${r.id}/favorite`);
    setReports((prev) => prev.map((x) => x.id === r.id ? { ...x, isFavorited: data.isFavorited } : x));
    if (data.isFavorited) {
      setFavorites((prev) => [{ ...r, isFavorited: true }, ...prev]);
    } else {
      setFavorites((prev) => prev.filter((x) => x.id !== r.id));
    }
  };

  const exportPDF = async (id, title) => {
    const res = await api.get(`/reports/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${title}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  const displayed = tab === 'mine' ? reports : favorites;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">Lúmina</h1>
        <div className="flex items-center gap-4">
          <Link to="/datasets" className="text-sm text-slate-600 hover:text-slate-900">Datasets</Link>
          <Link to="/explore" className="text-sm text-slate-600 hover:text-slate-900">Explorar</Link>
          <span className="text-sm text-slate-500">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-500 hover:underline">Salir</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6">
          {[
            { key: 'mine', label: `Mis reportes (${reports.length})` },
            { key: 'favorites', label: `Favoritos (${favorites.length})` },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t.key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Create form — only on "mine" tab */}
        {tab === 'mine' && (
          <form onSubmit={createReport} className="flex gap-3 mb-8">
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Nombre del nuevo reporte..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <button type="submit" disabled={creating}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50">
              + Nuevo reporte
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-slate-500 text-sm">Cargando...</p>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">{tab === 'favorites' ? '⭐' : '📊'}</p>
            <p className="text-sm">
              {tab === 'favorites' ? 'Aún no tienes favoritos. Visita Explorar para descubrir reportes públicos.' : '¡Crea tu primer reporte!'}
            </p>
            {tab === 'favorites' && (
              <Link to="/explore" className="mt-3 inline-block text-indigo-600 hover:underline text-sm">Ir a Explorar →</Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((r) => (
              <ReportCard key={r.id} report={r}
                isOwner={r.ownerId === user?.id}
                onDelete={deleteReport}
                onDuplicate={duplicateReport}
                onToggleFavorite={toggleFavorite}
                onExportPDF={exportPDF}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ReportCard({ report: r, isOwner, onDelete, onDuplicate, onToggleFavorite, onExportPDF }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 truncate">{r.title}</h3>
          {r.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{r.description}</p>}
          {r.owner && !isOwner && <p className="text-xs text-slate-400 mt-0.5">por {r.owner.name}</p>}
        </div>
        <button onClick={() => onToggleFavorite(r)}
          className={`ml-2 text-lg flex-shrink-0 transition ${r.isFavorited ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
          title={r.isFavorited ? 'Quitar de favoritos' : 'Agregar a favoritos'}>
          ★
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-slate-400">{r._count?.widgets ?? 0} widgets</span>
        <span className="text-slate-300">·</span>
        <span className="text-xs text-slate-400">{new Date(r.updatedAt).toLocaleDateString()}</span>
        {r.isPublic && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full ml-auto">Público</span>}
      </div>

      <div className="flex gap-1.5 mt-auto flex-wrap">
        <Link to={`/report/${r.id}`}
          className="flex-1 text-center text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg py-1.5 font-medium transition">
          {isOwner ? 'Editar' : 'Ver'}
        </Link>
        {isOwner && (
          <button onClick={() => onDuplicate(r)}
            className="text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg px-2 py-1.5 transition" title="Duplicar">
            ⧉
          </button>
        )}
        {isOwner && (
          <button onClick={() => onExportPDF(r.id, r.title)}
            className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg px-2 py-1.5 transition" title="Exportar PDF">
            PDF
          </button>
        )}
        {isOwner && (
          <button onClick={() => onDelete(r.id)}
            className="text-xs text-red-500 hover:bg-red-50 rounded-lg px-2 py-1.5 transition" title="Eliminar">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
