import { useEffect, useState } from 'react';
import api from '../lib/api';
import { Button, Icon, Modal } from './ui';

const ROLES = [
  { value: 'viewer', label: 'Puede ver' },
  { value: 'editor', label: 'Puede editar' },
];

// Modal de compartir: personas con rol (viewer/editor) + área + link público.
export default function ShareModal({ report, onChange, onClose }) {
  const [shares, setShares] = useState(null);
  const [areas, setAreas] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState(report.area?.id ?? '');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    api.get(`/reports/${report.id}/shares`)
      .then(({ data }) => setShares(data))
      .catch(() => setShares([]));
    api.get('/areas/mine')
      .then(({ data }) => setAreas(data))
      .catch(() => {});
  }, [report.id]);

  const upsertShare = async (targetEmail, targetRole) => {
    const { data } = await api.post(`/reports/${report.id}/shares`, { email: targetEmail, role: targetRole });
    setShares((prev) => {
      const rest = prev.filter((s) => s.user.id !== data.user.id);
      return [...rest, data].sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);
    });
    return data;
  };

  const addShare = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setMsg('');
    try {
      await upsertShare(email, role);
      setEmail('');
    } catch (err) {
      setMsg(err.response?.data?.error || 'No se pudo compartir');
    } finally {
      setBusy(false);
    }
  };

  const removeShare = async (s) => {
    await api.delete(`/reports/${report.id}/shares/${s.id}`);
    setShares((prev) => prev.filter((x) => x.id !== s.id));
  };

  const togglePublic = async () => {
    setToggling(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/share`);
      onChange({ isPublic: data.isPublic, slug: data.slug });
    } finally {
      setToggling(false);
    }
  };

  const publishToArea = async () => {
    setPublishing(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/publish`, { areaId: selectedAreaId || null });
      onChange({ areaId: data.areaId, area: data.area });
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async () => {
    setPublishing(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/publish`, { areaId: null });
      onChange({ areaId: data.areaId, area: data.area });
      setSelectedAreaId('');
    } finally {
      setPublishing(false);
    }
  };

  const publicUrl = report.slug ? `${window.location.origin}/public/${report.slug}` : '';
  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title={`Compartir · ${report.title}`} onClose={onClose}>
      {/* Personas */}
      <p className="text-xs font-semibold text-ink-soft uppercase tracking-widest mb-2">
        Personas con acceso
      </p>
      <form onSubmit={addShare} className="flex flex-col sm:flex-row gap-2 mb-3">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="email@ejemplo.com" className="field field-sm flex-1" />
        <div className="flex gap-2">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="field field-sm w-32">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <Button type="submit" size="sm" disabled={busy || !email.trim()}>
            <Icon name="plus" size={13} /> Invitar
          </Button>
        </div>
      </form>
      {msg && <p className="text-rust text-xs mb-3 bg-rust-soft px-3 py-2 rounded-lg">{msg}</p>}

      {shares === null ? (
        <div className="skeleton h-10 mb-4" />
      ) : shares.length === 0 ? (
        <p className="text-xs text-ink-faint mb-4">
          Nadie más tiene acceso. Invita por email — la persona debe tener cuenta en Lúmina.
        </p>
      ) : (
        <ul className="mb-4 divide-y divide-line-soft border border-line-soft rounded-lg overflow-hidden">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2 bg-surface">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-lumen-soft text-lumen-deep text-xs font-semibold shrink-0">
                {s.user.name?.[0]?.toUpperCase() || '?'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{s.user.name}</p>
                <p className="text-xs text-ink-faint font-mono truncate">{s.user.email}</p>
              </div>
              <select value={s.role}
                onChange={(e) => upsertShare(s.user.email, e.target.value)}
                className="field field-sm w-30 shrink-0">
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <button onClick={() => removeShare(s)} title="Quitar acceso"
                className="text-ink-faint hover:text-rust transition cursor-pointer p-1">
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Publicar al área */}
      {areas.length > 0 && (
        <div className="border-t border-line-soft pt-4 mt-2 mb-4">
          <p className="text-xs font-semibold text-ink-soft uppercase tracking-widest mb-2">
            Publicar al área
          </p>
          {report.area ? (
            <div className="flex items-center gap-3 bg-lumen-soft border border-lumen-line rounded-lg px-3 py-2.5">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-lumen-deep/10 text-lumen-deep shrink-0">
                <Icon name="layers" size={14} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink font-medium">Publicado en <span className="text-lumen-deep">{report.area.name}</span></p>
                <p className="text-xs text-ink-faint">Visible para todos los miembros del área.</p>
              </div>
              <Button size="sm" variant="soft" onClick={unpublish} disabled={publishing}>
                <Icon name="x" size={12} /> Despublicar
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select
                value={selectedAreaId}
                onChange={(e) => setSelectedAreaId(e.target.value)}
                className="field field-sm flex-1"
              >
                <option value="">Selecciona un área…</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <Button size="sm" onClick={publishToArea} disabled={publishing || !selectedAreaId}>
                <Icon name="layers" size={13} /> Publicar
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Link público */}
      <div className="border-t border-line-soft pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-ink-soft uppercase tracking-widest">Link público</p>
            <p className="text-xs text-ink-faint mt-0.5">
              {report.isPublic ? 'Cualquiera con el link puede ver este reporte.' : 'Solo personas invitadas tienen acceso.'}
            </p>
          </div>
          <Button size="sm" variant={report.isPublic ? 'soft' : 'primary'} onClick={togglePublic} disabled={toggling}>
            <Icon name={report.isPublic ? 'lock' : 'link'} size={13} />
            {report.isPublic ? 'Hacer privado' : 'Activar link'}
          </Button>
        </div>
        {report.isPublic && report.slug && (
          <div className="flex gap-2 mt-3">
            <input readOnly value={publicUrl} className="field field-sm field-mono flex-1" onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="soft" onClick={copyLink}>
              <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
