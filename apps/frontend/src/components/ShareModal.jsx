import { useEffect, useState } from 'react';
import api from '../lib/api';
import { Button, Icon, Modal } from './ui';

const ROLES = [
  { value: 'viewer', label: 'Puede ver' },
  { value: 'editor', label: 'Puede editar' },
];

// Modal de compartir: personas con rol (viewer/editor) + link público.
export default function ShareModal({ report, onChange, onClose }) {
  const [shares, setShares] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get(`/reports/${report.id}/shares`)
      .then(({ data }) => setShares(data))
      .catch(() => setShares([]));
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
