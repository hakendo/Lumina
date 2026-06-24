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
  const [filter, setFilter] = useState('all'); // 'all' | 'public' | 'area'

  const load = (query = '') =>
    api.get('/reports/explore', { params: query ? { q: query } : {} })
      .then(({ data }) => { setReports(data); setLoadError(''); })
      .catch(() => setLoadError('No se pudieron cargar los reportes.'))
      .finally(() => { setLoading(false); setSearching(false); });

  useEffect(() => { load(); }, []);

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

  const areaCount = reports.filter((r) => r.area).length;
  const publicCount = reports.filter((r) => r.isPublic).length;

  const displayed = filter === 'public' ? reports.filter((r) => r.isPublic)
    : filter === 'area' ? reports.filter((r) => r.area)
    : reports;

  const TABS = [
    { key: 'all', label: 'Todo', count: reports.length },
    { key: 'public', label: 'Públicos', count: publicCount },
    { key: 'area', label: 'De mis áreas', count: areaCount },
  ];

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-rise">
          <h2 className="font-display text-3xl text-ink">Explorar</h2>
          <p className="text-ink-faint text-sm mt-1">
            Reportes públicos y de tus áreas de trabajo.
          </p>
        </div>

        <form onSubmit={search} className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none">
              <Icon name="search" size={15} />
            </span>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre…" className="field pl-9" />
          </div>
          <Button type="submit" disabled={searching}>Buscar</Button>
        </form>

        {/* Tabs */}
        {!loading && !loadError && (
          <div className="flex gap-4 border-b border-line mb-6">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`pb-2.5 -mb-px text-sm font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
                  filter === t.key
                    ? 'border-lumen text-ink'
                    : 'border-transparent text-ink-faint hover:text-ink-soft'
                }`}>
                {t.label}
                <span className="ml-1.5 font-mono text-xs text-ink-faint">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <p className="text-rust text-sm bg-rust-soft px-4 py-3 rounded-lg">{loadError}</p>
        ) : loading ? (
          <SkeletonCards />
        ) : displayed.length === 0 ? (
          <EmptyState icon="search" title="Nada por aquí"
            hint={q ? `Sin resultados para "${q}".` : 'Todavía no hay reportes en esta categoría.'} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((r, i) => (
              <ExploreCard key={r.id} report={r} index={i}
                onToggleFavorite={toggleFavorite}
                onDuplicate={duplicate}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ExploreCard({ report: r, index, onToggleFavorite, onDuplicate }) {
  const pages = r._count?.pages ?? 0;
  return (
    <div
      className="bg-surface border border-line-soft rounded-xl p-5 shadow-card hover:shadow-lift hover:border-lumen-line hover:-translate-y-0.5 transition flex flex-col animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base text-ink truncate">{r.title}</h3>
          {r.description && <p className="text-xs text-ink-faint mt-0.5 truncate">{r.description}</p>}
          <p className="text-xs text-ink-faint mt-0.5">por {r.owner?.name}</p>
        </div>
        <button onClick={() => onToggleFavorite(r)}
          className={`ml-2 shrink-0 transition cursor-pointer ${r.isFavorited ? 'text-lumen-glow' : 'text-line hover:text-lumen-glow'}`}
          title={r.isFavorited ? 'Quitar de favoritos' : 'Agregar a favoritos'}>
          <Icon name="star" size={17} filled={r.isFavorited} />
        </button>
      </div>

      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-4 font-mono text-[11px] text-ink-faint">
        <span>{r._count?.widgets ?? 0} widgets</span>
        {pages > 1 && <><span className="text-line">·</span><span>{pages} págs</span></>}
        <span className="text-line">·</span>
        <span className="inline-flex items-center gap-0.5">{r._count?.favoritedBy ?? 0} <Icon name="star" size={10} filled /></span>
        <span className="text-line">·</span>
        <span>{new Date(r.updatedAt).toLocaleDateString()}</span>
        {r.isPublic && (
          <span className="font-sans text-[11px] bg-sea-soft text-sea px-2 py-0.5 rounded-full">Público</span>
        )}
        {r.area && (
          <span className="font-sans text-[11px] bg-lumen-soft text-lumen-deep px-2 py-0.5 rounded-full flex items-center gap-1">
            <Icon name="layers" size={9} /> {r.area.name}
          </span>
        )}
      </div>

      <div className="flex gap-1.5 mt-auto">
        <Link to={`/report/${r.id}/view`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs bg-paper-deep text-ink hover:bg-lumen-soft hover:text-lumen-deep rounded-lg py-1.5 font-medium transition">
          <Icon name="eye" size={13} /> Ver reporte
        </Link>
        <button onClick={() => onDuplicate(r)} title="Copiar a mis reportes"
          className="inline-flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink hover:bg-paper-deep rounded-lg px-3 py-1.5 transition cursor-pointer">
          <Icon name="copy" size={13} /> Copiar
        </button>
      </div>
    </div>
  );
}
