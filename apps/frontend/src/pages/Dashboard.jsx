import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

export default function Dashboard() {
  const { user, logout } = useAuthStore();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/reports').then(({ data }) => { setReports(data); setLoading(false); });
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

  const exportPDF = async (id, title) => {
    const res = await api.get(`/reports/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${title}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">Nexus Reports</h1>
        <div className="flex items-center gap-3">
          <Link to="/datasets" className="text-sm text-slate-600 hover:text-slate-900">Datasets</Link>
          <span className="text-sm text-slate-500">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Salir</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-slate-800">Mis reportes</h2>
        </div>

        <form onSubmit={createReport} className="flex gap-3 mb-8">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nombre del nuevo reporte..."
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
          >
            + Nuevo reporte
          </button>
        </form>

        {loading ? (
          <p className="text-slate-500 text-sm">Cargando...</p>
        ) : reports.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">📊</p>
            <p>Aún no tienes reportes. ¡Crea el primero!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reports.map((r) => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-800">{r.title}</h3>
                    {r.description && <p className="text-xs text-slate-500 mt-0.5">{r.description}</p>}
                  </div>
                  {r.isPublic && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Público</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  {r._count?.widgets ?? 0} widgets · {new Date(r.updatedAt).toLocaleDateString()}
                </p>
                <div className="flex gap-2">
                  <Link
                    to={`/report/${r.id}`}
                    className="flex-1 text-center text-sm bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg py-1.5 font-medium transition"
                  >
                    Editar
                  </Link>
                  <button
                    onClick={() => exportPDF(r.id, r.title)}
                    className="text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition"
                    title="Exportar PDF"
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => deleteReport(r.id)}
                    className="text-sm text-red-500 hover:bg-red-50 rounded-lg px-2 py-1.5 transition"
                    title="Eliminar"
                  >
                    ✕
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
