import { useState, useEffect, useCallback } from 'react';
import { AppHeader, Icon, Button, Modal, Field } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { applyOrgTheme, FONT_DISPLAY_OPTIONS, FONT_SANS_OPTIONS } from '../lib/theme';
import api from '../lib/api';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function formatMB(mb) {
  if (mb == null) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

const ROLE_LABEL = { org_admin: 'Admin', member: 'Miembro' };

/* ── Tab: Usuarios ────────────────────────────────────────────────────── */

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'member' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/org/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openInvite = () => { setForm({ name: '', email: '', role: 'member' }); setError(''); setInviteOpen(true); };
  const openEdit = (u) => { setForm({ role: u.role, isActive: u.isActive, mfaEnforced: u.mfaEnforced }); setError(''); setEditUser(u); };

  const handleInvite = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/org/users/invite', form);
      setInviteOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al invitar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch(`/org/users/${editUser.id}`, form);
      setEditUser(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al actualizar usuario');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (userId) => {
    if (!confirm('¿Quitar este usuario de la organización?')) return;
    await api.delete(`/org/users/${userId}`);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-ink">Miembros</h2>
        <Button size="sm" onClick={openInvite}>
          <Icon name="userPlus" size={14} /> Invitar
        </Button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-rust border border-rust/20 bg-rust/5 rounded-lg px-3 py-2">{error}</p>
      )}

      {loading ? (
        <p className="text-ink-faint text-sm">Cargando…</p>
      ) : (
        <div className="divide-y divide-line-soft border border-line rounded-xl overflow-hidden">
          {users.length === 0 && !error && (
            <p className="px-4 py-6 text-sm text-ink-faint text-center">Sin miembros</p>
          )}
          {users.map(u => (
            <div key={u.id} className="px-4 py-3 flex items-center gap-3 bg-surface">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{u.name}</p>
                <p className="text-xs text-ink-faint truncate">{u.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                u.role === 'org_admin' ? 'bg-lumen-soft text-lumen-deep' : 'bg-paper-deep text-ink-soft'
              }`}>
                {ROLE_LABEL[u.role] ?? u.role}
              </span>
              {!u.isActive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-rust/10 text-rust font-medium">
                  Inactivo
                </span>
              )}
              {u.mfaEnforced && (
                <Icon name="shield" size={14} className="text-lumen" title="MFA obligatorio" />
              )}
              <button onClick={() => openEdit(u)}
                className="p-1.5 rounded-lg hover:bg-paper-deep text-ink-faint hover:text-ink transition cursor-pointer">
                <Icon name="pencil" size={14} />
              </button>
              <button onClick={() => handleRemove(u.id)}
                className="p-1.5 rounded-lg hover:bg-paper-deep text-ink-faint hover:text-rust transition cursor-pointer">
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {inviteOpen && (
        <Modal title="Invitar usuario" onClose={() => setInviteOpen(false)}>
          <form onSubmit={handleInvite} className="space-y-4">
            <Field label="Nombre">
              <input className="field" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Correo electrónico">
              <input className="field" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </Field>
            <Field label="Rol">
              <select className="field" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="member">Miembro</option>
                <option value="org_admin">Admin de organización</option>
              </select>
            </Field>
            {error && <p className="text-xs text-rust">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setInviteOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Invitando…' : 'Invitar'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && (
        <Modal title={`Editar: ${editUser.name}`} onClose={() => setEditUser(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <Field label="Rol en la organización">
              <select className="field" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="member">Miembro</option>
                <option value="org_admin">Admin de organización</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              <span className="text-sm text-ink">Cuenta activa</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.mfaEnforced}
                onChange={e => setForm(f => ({ ...f, mfaEnforced: e.target.checked }))} />
              <span className="text-sm text-ink">Exigir MFA (TOTP)</span>
            </label>
            {error && <p className="text-xs text-rust">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setEditUser(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ── Tab: Papelera ────────────────────────────────────────────────────── */

function TrashTab() {
  const [items, setItems] = useState({ reports: [], datasets: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/org/trash');
      setItems(data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al cargar papelera');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (type, id) => {
    await api.post(`/org/trash/${type}/${id}/restore`);
    load();
  };

  const purge = async (type, id) => {
    if (!confirm('¿Eliminar permanentemente? Esta acción no se puede deshacer.')) return;
    await api.delete(`/org/trash/${type}/${id}`);
    load();
  };

  const Section = ({ label, data, type }) => (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-2">{label}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-ink-faint px-4 py-3 border border-line rounded-xl text-center">Vacío</p>
      ) : (
        <div className="divide-y divide-line-soft border border-line rounded-xl overflow-hidden">
          {data.map(item => (
            <div key={item.id} className="px-4 py-3 flex items-center gap-3 bg-surface">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{item.name ?? item.title}</p>
                <p className="text-xs text-ink-faint">
                  Eliminado: {new Date(item.deletedAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>
              <Button size="sm" variant="soft" onClick={() => restore(type, item.id)}>
                <Icon name="refresh" size={13} /> Restaurar
              </Button>
              <Button size="sm" variant="danger" onClick={() => purge(type, item.id)}>
                <Icon name="trash" size={13} /> Eliminar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {error && (
        <p className="mb-4 text-sm text-rust border border-rust/20 bg-rust/5 rounded-lg px-3 py-2">{error}</p>
      )}
      <p className="text-sm text-ink-faint mb-4">
        Elementos eliminados durante el período de retención del plan activo.
      </p>
      {loading ? <p className="text-ink-faint text-sm">Cargando…</p> : (
        <>
          <Section label="Reportes" data={items.reports ?? []} type="reports" />
          <Section label="Datasets" data={items.datasets ?? []} type="datasets" />
        </>
      )}
    </div>
  );
}

/* ── Tab: Políticas ───────────────────────────────────────────────────── */

const POLICY_FIELDS = [
  { key: 'allowPublicLink',      label: 'Permitir enlaces públicos' },
  { key: 'allowExternalShare',   label: 'Permitir compartir externo' },
  { key: 'allowPublishToArea',   label: 'Permitir publicar en áreas' },
  { key: 'allowCreateReport',    label: 'Permitir crear reportes' },
];

// Normaliza las claves del backend (policyAllow* → allow*) al formato que usa el formulario.
function normalizePolicy(data) {
  if (!data) return {};
  return {
    allowPublicLink:    data.allowPublicLink    ?? data.policyAllowPublicLink    ?? true,
    allowExternalShare: data.allowExternalShare ?? data.policyAllowExternalShare ?? true,
    allowPublishToArea: data.allowPublishToArea ?? data.policyAllowPublishToArea ?? true,
    allowCreateReport:  data.allowCreateReport  ?? data.policyAllowCreateReport  ?? true,
  };
}

function PolicyCard({ title, policy, onSave, inherited = false }) {
  const [form, setForm] = useState(() => normalizePolicy(policy));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setForm(normalizePolicy(policy)); }, [policy]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-line rounded-xl p-4 mb-4 bg-surface">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {inherited && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-paper-deep text-ink-faint">
            Hereda de la org
          </span>
        )}
      </div>
      <div className="space-y-2">
        {POLICY_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
            <span className="text-sm text-ink">{label}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-rust mt-2">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-3">
        {saved && (
          <span className="text-xs text-sea font-medium flex items-center gap-1">
            <Icon name="check" size={13} /> Guardado
          </span>
        )}
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}

function PoliciesTab() {
  const [orgPolicy, setOrgPolicy] = useState(null);
  const [areas, setAreas] = useState([]);
  const [areaPolicies, setAreaPolicies] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, aRes] = await Promise.all([
        api.get('/org/policy'),
        api.get('/areas'),
      ]);
      setOrgPolicy(normalizePolicy(pRes.data));
      setAreas(aRes.data);

      const byArea = {};
      await Promise.all(
        aRes.data.map(async (area) => {
          try {
            const { data } = await api.get(`/org/areas/${area.id}/policy`);
            byArea[area.id] = normalizePolicy(data);
          } catch { byArea[area.id] = null; }
        })
      );
      setAreaPolicies(byArea);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveOrgPolicy = async (form) => {
    await api.put('/org/policy', form);
    setOrgPolicy(form);
  };

  const saveAreaPolicy = async (areaId, form) => {
    await api.put(`/org/areas/${areaId}/policy`, form);
    setAreaPolicies(p => ({ ...p, [areaId]: { ...form, inherited: false } }));
  };

  if (loading) return <p className="text-ink-faint text-sm">Cargando…</p>;

  return (
    <div>
      <p className="text-sm text-ink-faint mb-4">
        Las áreas sin política propia heredan la política de la organización.
      </p>
      <PolicyCard title="Política de organización" policy={orgPolicy} onSave={saveOrgPolicy} />
      {areas.map(area => (
        <PolicyCard
          key={area.id}
          title={`Área: ${area.name}`}
          policy={areaPolicies[area.id] ?? orgPolicy}
          inherited={areaPolicies[area.id]?.inherited ?? true}
          onSave={(form) => saveAreaPolicy(area.id, form)}
        />
      ))}
    </div>
  );
}

/* ── Tab: Storage ─────────────────────────────────────────────────────── */

function StorageTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/org/storage').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-ink-faint text-sm">Cargando…</p>;
  if (!data) return <p className="text-sm text-rust">Error al cargar almacenamiento</p>;

  const pct = data.pct ?? (data.limitMB ? Math.round((data.usedMB / data.limitMB) * 100) : null);
  const color = pct == null ? 'bg-lumen' : pct >= 90 ? 'bg-rust' : pct >= 70 ? 'bg-lumen' : 'bg-sea';

  return (
    <div>
      <div className="border border-line rounded-xl p-5 bg-surface">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-2xl font-bold font-mono text-ink">{formatMB(data.usedMB)}</p>
            <p className="text-sm text-ink-faint mt-0.5">
              {data.limitMB ? `de ${formatMB(data.limitMB)} disponibles` : 'Sin límite de almacenamiento'}
            </p>
          </div>
          {pct != null && (
            <p className={`text-2xl font-bold font-mono ${pct >= 90 ? 'text-rust' : 'text-ink-soft'}`}>
              {pct}%
            </p>
          )}
        </div>
        {pct != null && (
          <div className="h-3 rounded-full bg-paper-deep overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${color}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
        {pct >= 90 && (
          <p className="text-xs text-rust mt-3">
            Almacenamiento casi lleno. Los syncs se bloquearán al alcanzar el límite.
          </p>
        )}
      </div>
      <p className="text-xs text-ink-faint mt-3">
        El uso se mide como el tamaño serializado de los datos sincronizados (filas de datasets).
        Contacta al administrador de Lúmina para ampliar tu plan.
      </p>
    </div>
  );
}

/* ── Tab: Apariencia ──────────────────────────────────────────────────── */
// Override de tokens visuales (color/tipografía) por organización, aplicado
// en runtime como CSS custom properties sobre :root (ver src/lib/theme.js).
// El form guarda siempre las 7 claves como string ('' = usar el default de
// la app); así "Guardar" determina el estado completo sin ambigüedad.

const THEME_COLOR_FIELDS = [
  { key: 'lumen',     label: 'Acento primario', hint: 'Botones, links, foco' },
  { key: 'lumenDeep', label: 'Acento oscuro',    hint: 'Hover, texto sobre fondo suave' },
  { key: 'lumenGlow', label: 'Acento brillo',    hint: 'Detalles, mascota, marcadores de mapa' },
  { key: 'sea',       label: 'Éxito / público',  hint: 'Reportes públicos, confirmaciones' },
  { key: 'rust',      label: 'Peligro',          hint: 'Errores, acciones destructivas' },
];

// Solo para mostrar un swatch válido en el <input type="color"> cuando el
// campo está vacío (= sin override) — coincide con los defaults de index.css.
const APP_DEFAULTS = {
  lumen: '#133896', lumenDeep: '#031560', lumenGlow: '#08cdff',
  sea: '#157a52', rust: '#b3222f',
};

const EMPTY_THEME_FORM = {
  lumen: '', lumenDeep: '', lumenGlow: '', sea: '', rust: '', fontDisplay: '', fontSans: '',
};

function normalizeTheme(data) {
  return { ...EMPTY_THEME_FORM, ...Object.fromEntries(
    Object.entries(data ?? {}).filter(([k]) => k in EMPTY_THEME_FORM)
  ) };
}

function ThemeTab() {
  const setOrgTheme = useAuthStore((s) => s.setOrgTheme);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/org/theme');
      setForm(normalizeTheme(data));
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al cargar el tema');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Vista previa en vivo mientras se edita — no persiste hasta Guardar.
  useEffect(() => { if (form) applyOrgTheme(form); }, [form]);

  // Al salir de la pestaña sin guardar, vuelve a aplicar el tema real de la sesión.
  useEffect(() => () => { applyOrgTheme(useAuthStore.getState().user?.orgTheme); }, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const { data } = await api.put('/org/theme', form);
      const next = normalizeTheme(data);
      setForm(next);
      setOrgTheme(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar el tema');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <p className="text-ink-faint text-sm">Cargando…</p>;

  return (
    <form onSubmit={handleSave}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-ink-faint max-w-md">
          Personaliza los colores y la tipografía de esta organización. La vista previa
          se aplica al instante; los demás usuarios la ven al recargar tras Guardar.
        </p>
        <button type="button" onClick={() => setForm(EMPTY_THEME_FORM)}
          className="text-xs text-ink-faint hover:text-rust transition cursor-pointer shrink-0">
          Restablecer todo
        </button>
      </div>

      <div className="border border-line rounded-xl p-4 mb-4 bg-surface">
        <h3 className="text-sm font-semibold text-ink mb-3">Colores</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {THEME_COLOR_FIELDS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-3">
              <input type="color" value={form[key] || APP_DEFAULTS[key]}
                onChange={(e) => set(key, e.target.value)}
                className="h-9 w-12 rounded-lg cursor-pointer border border-line bg-surface shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink font-medium">{label}</p>
                <p className="text-xs text-ink-faint truncate">{hint}</p>
              </div>
              {form[key] && (
                <button type="button" onClick={() => set(key, '')}
                  className="text-[11px] text-ink-faint hover:text-lumen-deep transition cursor-pointer underline underline-offset-2 shrink-0">
                  Predeterminado
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border border-line rounded-xl p-4 mb-4 bg-surface">
        <h3 className="text-sm font-semibold text-ink mb-3">Tipografía</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Fuente de títulos">
            <select className="field" value={form.fontDisplay} onChange={(e) => set('fontDisplay', e.target.value)}>
              <option value="">Predeterminada (Barlow)</option>
              {FONT_DISPLAY_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Fuente de texto">
            <select className="field" value={form.fontSans} onChange={(e) => set('fontSans', e.target.value)}>
              <option value="">Predeterminada (Nunito Sans)</option>
              {FONT_SANS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="border border-line-soft rounded-xl p-5 bg-paper-deep">
        <p className="text-xs font-semibold text-ink-faint uppercase tracking-wide mb-3">Vista previa</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-xl font-semibold text-ink">Lúmina</span>
          <Button type="button" variant="accent" size="sm">Acción primaria</Button>
          <span className="text-xs px-2 py-1 rounded-full bg-lumen-soft text-lumen-deep font-medium">Etiqueta</span>
          <span className="text-xs px-2 py-1 rounded-full bg-sea-soft text-sea font-medium">Éxito</span>
          <span className="text-xs px-2 py-1 rounded-full bg-rust-soft text-rust font-medium">Error</span>
        </div>
      </div>

      {error && <p className="text-xs text-rust mt-3">{error}</p>}
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved && (
          <span className="text-xs text-sea font-medium flex items-center gap-1">
            <Icon name="check" size={13} /> Guardado
          </span>
        )}
        <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </form>
  );
}

/* ── Página principal ─────────────────────────────────────────────────── */

const TABS = [
  { id: 'users',    label: 'Usuarios',   icon: 'users' },
  { id: 'trash',    label: 'Papelera',   icon: 'trash' },
  { id: 'policies', label: 'Políticas',  icon: 'shield' },
  { id: 'storage',  label: 'Storage',    icon: 'database' },
  { id: 'theme',    label: 'Apariencia', icon: 'sliders' },
];

export default function OrgAdmin() {
  const { user, token } = useAuthStore();
  const [tab, setTab] = useState('users');

  // user es null mientras loadUser() carga — esperar antes de denegar
  if (token && !user) {
    return (
      <div className="min-h-screen paper-bg flex items-center justify-center">
        <p className="text-ink-faint text-sm">Cargando…</p>
      </div>
    );
  }

  const isAuthorized = user?.role === 'org_admin' || user?.role === 'superadmin';

  if (!isAuthorized) {
    return (
      <div className="min-h-screen paper-bg">
        <AppHeader />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
          <p className="text-rust text-sm">
            Acceso denegado. Solo admins de organización.
            {user && <span className="ml-1 font-mono text-xs">(rol actual: {user.role})</span>}
          </p>
        </main>
      </div>
    );
  }

  // Superadmin sin org activa — necesita seleccionar una org desde el switcher
  if (user?.role === 'superadmin' && !user?.orgId) {
    return (
      <div className="min-h-screen paper-bg">
        <AppHeader />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
          <p className="text-ink-soft text-sm">
            Selecciona una organización desde el menú superior para administrarla.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-display font-bold text-ink">Administración</h1>
          <p className="text-sm text-ink-faint mt-1">{user?.orgName}</p>
        </div>

        <div className="flex gap-1 mb-6 border-b border-line">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition -mb-px border-b-2 cursor-pointer ${
                tab === t.id
                  ? 'border-lumen text-lumen-deep'
                  : 'border-transparent text-ink-soft hover:text-ink'
              }`}>
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>

        <div>
          {tab === 'users'    && <UsersTab />}
          {tab === 'trash'    && <TrashTab />}
          {tab === 'policies' && <PoliciesTab />}
          {tab === 'storage'  && <StorageTab />}
          {tab === 'theme'    && <ThemeTab />}
        </div>
      </main>
    </div>
  );
}
