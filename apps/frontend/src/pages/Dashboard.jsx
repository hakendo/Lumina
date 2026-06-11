import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { AppHeader, Button, ConfirmModal, EmptyState, Icon, SkeletonCards } from '../components/ui';

export default function Dashboard() {
  const { user } = useAuthStore();
  const [reports, setReports] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('mine'); // mine | shared | favorites
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/reports'),
      api.get('/reports/favorites'),
      api.get('/reports/shared'),
    ])
      .then(([r, f, s]) => {
        setReports(r.data);
        setFavorites(f.data);
        setShared(s.data);
      })
      .catch(() => setLoadError('No se pudieron cargar tus reportes. Recarga la página.'))
      .finally(() => setLoading(false));
  }, []);

  const createReport = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post('/reports', { title: newTitle });
      setNewTitle('');
      navigate(`/report/${data.id}`);
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    const id = deleteTarget.id;
    setDeleteTarget(null);
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

  const displayed = tab === 'mine' ? reports : tab === 'shared' ? shared : favorites;

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-rise">
          <h2 className="font-display text-3xl text-ink">
            {user?.name ? `Hola, ${user.name.split(' ')[0]}` : 'Tus reportes'}
          </h2>
          <p className="text-ink-faint text-sm mt-1">
            {reports.length === 1 ? '1 reporte' : `${reports.length} reportes`} · {shared.length} compartidos contigo · {favorites.length} en favoritos
          </p>
        </div>

        {/* Tabs editoriales */}
        <div className="flex gap-4 sm:gap-6 border-b border-line mb-6 overflow-x-auto">
          {[
            { key: 'mine', label: 'Mis reportes', count: reports.length },
            { key: 'shared', label: 'Compartidos', count: shared.length },
            { key: 'favorites', label: 'Favoritos', count: favorites.length },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`pb-2.5 -mb-px text-sm font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
                tab === t.key
                  ? 'border-lumen text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink-soft'
              }`}>
              {t.label}
              <span className="ml-1.5 font-mono text-xs text-ink-faint">{t.count}</span>
            </button>
          ))}
        </div>

        {tab === 'mine' && (
          <form onSubmit={createReport} className="flex flex-col sm:flex-row gap-3 mb-8">
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Nombre del nuevo reporte…" className="field flex-1" />
            <Button type="submit" disabled={creating || !newTitle.trim()}>
              <Icon name="plus" size={14} /> Nuevo reporte
            </Button>
          </form>
        )}

        {loadError ? (
          <p className="text-rust text-sm bg-rust-soft px-4 py-3 rounded-lg">{loadError}</p>
        ) : loading ? (
          <SkeletonCards />
        ) : displayed.length === 0 ? (
          tab === 'favorites' ? (
            <EmptyState icon="star" title="Aún no tienes favoritos"
              hint="Visita Explorar para descubrir reportes públicos de otras personas.">
              <Link to="/explore" className="text-lumen-deep text-sm font-medium hover:underline">
                Ir a Explorar →
              </Link>
            </EmptyState>
          ) : tab === 'shared' ? (
            <EmptyState icon="link" title="Nada compartido contigo"
              hint="Cuando alguien comparta un reporte con tu email, aparecerá aquí." />
          ) : (
            <EmptyState icon="chart" title="Tu mesa está vacía"
              hint="Dale un nombre a tu primer reporte arriba y empieza a armar tu dashboard." />
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((r, i) => (
              <ReportCard key={r.id} report={r} index={i}
                isOwner={r.ownerId === user?.id}
                canEdit={r.ownerId === user?.id || r.myRole === 'editor'}
                onDelete={(rep) => setDeleteTarget(rep)}
                onDuplicate={duplicateReport}
                onToggleFavorite={toggleFavorite}
                onExportPDF={exportPDF}
              />
            ))}
          </div>
        )}
      </main>

      {deleteTarget && (
        <ConfirmModal
          title="Eliminar reporte"
          message={`"${deleteTarget.title}" se eliminará de forma permanente, incluidos sus widgets. Esta acción no se puede deshacer.`}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function ReportCard({ report: r, index, isOwner, canEdit, onDelete, onDuplicate, onToggleFavorite, onExportPDF }) {
  return (
    <div
      className="group bg-surface border border-line-soft rounded-xl p-5 shadow-card hover:shadow-lift hover:border-lumen-line hover:-translate-y-0.5 transition flex flex-col animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base text-ink truncate">{r.title}</h3>
          {r.description && <p className="text-xs text-ink-faint mt-0.5 truncate">{r.description}</p>}
          {r.owner && !isOwner && <p className="text-xs text-ink-faint mt-0.5">por {r.owner.name}</p>}
        </div>
        <button onClick={() => onToggleFavorite(r)}
          className={`ml-2 shrink-0 transition cursor-pointer ${r.isFavorited ? 'text-lumen-glow' : 'text-line hover:text-lumen-glow'}`}
          title={r.isFavorited ? 'Quitar de favoritos' : 'Agregar a favoritos'}>
          <Icon name="star" size={17} filled={r.isFavorited} />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 font-mono text-[11px] text-ink-faint">
        <span>{r._count?.widgets ?? 0} widgets</span>
        <span className="text-line">·</span>
        <span>{new Date(r.updatedAt).toLocaleDateString()}</span>
        {r.isPublic && (
          <span className="ml-auto font-sans text-[11px] bg-sea-soft text-sea px-2 py-0.5 rounded-full">
            Público
          </span>
        )}
      </div>

      <div className="flex gap-1.5 mt-auto">
        <Link to={`/report/${r.id}/view`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs bg-paper-deep text-ink hover:bg-lumen-soft hover:text-lumen-deep rounded-lg py-1.5 font-medium transition">
          <Icon name="eye" size={13} /> Ver
        </Link>
        {canEdit && (
          <Link to={`/report/${r.id}`} title="Editar"
            className="inline-flex items-center rounded-lg px-2 py-1.5 text-ink-faint hover:text-ink hover:bg-paper-deep transition">
            <Icon name="pencil" size={14} />
          </Link>
        )}
        {isOwner && (
          <>
            <CardAction title="Duplicar" icon="copy" onClick={() => onDuplicate(r)} />
            <CardAction title="Exportar PDF" icon="download" onClick={() => onExportPDF(r.id, r.title)} />
            <CardAction title="Eliminar" icon="trash" danger onClick={() => onDelete(r)} />
          </>
        )}
      </div>
    </div>
  );
}

function CardAction({ title, icon, onClick, danger = false }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`rounded-lg px-2 py-1.5 transition cursor-pointer ${
        danger ? 'text-ink-faint hover:text-rust hover:bg-rust-soft' : 'text-ink-faint hover:text-ink hover:bg-paper-deep'
      }`}>
      <Icon name={icon} size={14} />
    </button>
  );
}
