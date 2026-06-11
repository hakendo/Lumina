import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { AppHeader, Button, EmptyState, Icon, SkeletonCards } from '../components/ui';

export default function Explore() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const load = (query = '') =>
    api.get('/reports/explore', { params: query ? { q: query } : {} })
      .then(({ data }) => {
        setReports(data);
        setLoadError('');
      })
      .catch(() => setLoadError('No se pudieron cargar los reportes públicos.'))
      .finally(() => {
        setLoading(false);
        setSearching(false);
      });

  useEffect(() => {
    load();
  }, []);

  const search = (e) => {
    e.preventDefault();
    setSearching(true);
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
    <div className="min-h-screen paper-bg">
      <AppHeader />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-rise">
          <h2 className="font-display text-3xl text-ink">Explorar</h2>
          <p className="text-ink-faint text-sm mt-1">Reportes públicos de la comunidad.</p>
        </div>

        <form onSubmit={search} className="flex gap-3 mb-8">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none">
              <Icon name="search" size={15} />
            </span>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre…" className="field pl-9" />
          </div>
          <Button type="submit" disabled={searching}>Buscar</Button>
        </form>

        {loadError ? (
          <p className="text-rust text-sm bg-rust-soft px-4 py-3 rounded-lg">{loadError}</p>
        ) : loading ? (
          <SkeletonCards />
        ) : reports.length === 0 ? (
          <EmptyState icon="search" title="Nada por aquí"
            hint={q ? `No se encontraron reportes públicos para "${q}".` : 'Todavía no hay reportes públicos.'} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reports.map((r, i) => (
              <div key={r.id}
                className="bg-surface border border-line-soft rounded-xl p-5 shadow-card hover:shadow-lift hover:border-lumen-line hover:-translate-y-0.5 transition flex flex-col animate-rise"
                style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-base text-ink truncate">{r.title}</h3>
                    {r.description && <p className="text-xs text-ink-faint mt-0.5 truncate">{r.description}</p>}
                    <p className="text-xs text-ink-faint mt-0.5">por {r.owner?.name}</p>
                  </div>
                  <button onClick={() => toggleFavorite(r)}
                    className={`ml-2 shrink-0 transition cursor-pointer ${r.isFavorited ? 'text-lumen-glow' : 'text-line hover:text-lumen-glow'}`}
                    title={r.isFavorited ? 'Quitar de favoritos' : 'Agregar a favoritos'}>
                    <Icon name="star" size={17} filled={r.isFavorited} />
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-4 font-mono text-[11px] text-ink-faint">
                  <span>{r._count?.widgets ?? 0} widgets</span>
                  <span className="text-line">·</span>
                  <span className="inline-flex items-center gap-0.5">
                    {r._count?.favoritedBy ?? 0} <Icon name="star" size={10} filled />
                  </span>
                  <span className="text-line">·</span>
                  <span>{new Date(r.updatedAt).toLocaleDateString()}</span>
                </div>

                <div className="flex gap-1.5 mt-auto">
                  <Link to={`/report/${r.id}/view`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs bg-paper-deep text-ink hover:bg-lumen-soft hover:text-lumen-deep rounded-lg py-1.5 font-medium transition">
                    <Icon name="eye" size={13} /> Ver reporte
                  </Link>
                  <button onClick={() => duplicate(r)} title="Copiar a mis reportes"
                    className="inline-flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink hover:bg-paper-deep rounded-lg px-3 py-1.5 transition cursor-pointer">
                    <Icon name="copy" size={13} /> Copiar
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
