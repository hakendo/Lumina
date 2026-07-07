import { useEffect, useState, useCallback } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { AppHeader, Button, Field, Icon, Modal, ConfirmModal, EmptyState } from '../components/ui';

// ── Constantes ────────────────────────────────────────────────────

const ROLE_LABEL = { member: 'Miembro', org_admin: 'Admin org.', superadmin: 'Super admin' };

// ── Badges ────────────────────────────────────────────────────────

function StatusBadge({ active }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
      active ? 'bg-sea-soft text-sea' : 'bg-rust-soft text-rust'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-sea' : 'bg-rust'}`} />
      {active ? 'Activa' : 'Inactiva'}
    </span>
  );
}

function RoleBadge({ role }) {
  const colors = {
    superadmin: 'bg-lumen-soft text-lumen-deep font-semibold',
    org_admin: 'bg-paper-deep text-ink font-medium',
    member: 'text-ink-soft',
  };
  return <span className={`text-xs ${colors[role] || 'text-ink-soft'} px-2 py-0.5 rounded-full`}>{ROLE_LABEL[role] || role}</span>;
}

// ── Modal: Org ────────────────────────────────────────────────────

function OrgModal({ org, onSaved, onClose }) {
  const isNew = !org;
  const [form, setForm] = useState({ name: org?.name || '', slug: org?.slug || '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const autoSlug = (name) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 48);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { data } = isNew
        ? await api.post('/admin/orgs', form)
        : await api.patch(`/admin/orgs/${org.id}`, { name: form.name });
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Nueva organización' : `Editar: ${org.name}`} onClose={onClose} maxWidth="max-w-sm">
      {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre">
          <input className="field" value={form.name} onChange={(e) => {
            const name = e.target.value;
            setForm((f) => ({ ...f, name, ...(isNew && { slug: autoSlug(name) }) }));
          }} required placeholder="Acme Corp" />
        </Field>
        {isNew && (
          <Field label="Slug" hint="Solo letras minúsculas, números y guiones. No se puede cambiar después.">
            <input className="field field-mono" value={form.slug} onChange={set('slug')}
              required pattern="^[a-z0-9-]+$" placeholder="acme-corp" />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : isNew ? 'Crear' : 'Guardar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal: Área ───────────────────────────────────────────────────

function AreaModal({ area, orgId, onSaved, onClose }) {
  const isNew = !area;
  const [name, setName] = useState(area?.name || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const { data } = isNew
        ? await api.post(`/admin/orgs/${orgId}/areas`, { name })
        : await api.patch(`/admin/orgs/${orgId}/areas/${area.id}`, { name });
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Nueva área' : `Editar: ${area.name}`} onClose={onClose} maxWidth="max-w-sm">
      {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre del área">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ventas, Finanzas, Marketing…" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : isNew ? 'Crear área' : 'Guardar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal: Usuario ────────────────────────────────────────────────

function UserModal({ user, orgId, onSaved, onClose }) {
  const isNew = !user;
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'member',
    orgId: user?.orgId || orgId || '',
    mfaEnforced: user?.mfaEnforced || false,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (payload.role === 'superadmin') payload.orgId = null;
      const { data } = isNew
        ? await api.post('/admin/users', payload)
        : await api.patch(`/admin/users/${user.id}`, payload);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Nueva cuenta' : `Editar: ${user.name}`} onClose={onClose} maxWidth="max-w-md">
      {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre">
          <input className="field" value={form.name} onChange={set('name')} required placeholder="Nombre y apellido" />
        </Field>
        <Field label="Email">
          <input className="field" type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label={isNew ? 'Contraseña' : 'Nueva contraseña'} hint={!isNew ? 'Vacía = no cambiar' : 'Mínimo 8 caracteres'}>
          <input className="field" type="password" value={form.password} onChange={set('password')}
            required={isNew} minLength={8} autoComplete="new-password" placeholder="••••••••" />
        </Field>
        <Field label="Rol">
          <select className="field" value={form.role} onChange={set('role')}>
            <option value="member">Miembro</option>
            <option value="org_admin">Admin de organización</option>
            <option value="superadmin">Super admin</option>
          </select>
        </Field>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={form.mfaEnforced} onChange={set('mfaEnforced')} className="mt-0.5 accent-current" />
          <span className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">Exigir MFA</span>
            <br />Deberá configurar verificación en dos pasos en su próximo inicio de sesión.
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : isNew ? 'Crear cuenta' : 'Guardar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Panel: Usuarios de la org ─────────────────────────────────────

function OrgUsersPanel({ org, me }) {
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/admin/users?orgId=${org.id}`)
      .then(({ data }) => setUsers(data))
      .catch(() => setError('No se pudo cargar usuarios'));
  }, [org.id]);

  useEffect(() => { load(); }, [load]);

  const replaceUser = (u) => setUsers((list) => list.map((x) => (x.id === u.id ? u : x)));

  const patch = async (u, data) => {
    try {
      const { data: updated } = await api.patch(`/admin/users/${u.id}`, data);
      replaceUser(updated);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar');
    }
  };

  const resetMfa = async (u) => {
    try {
      const { data } = await api.post(`/admin/users/${u.id}/mfa/reset`);
      replaceUser(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al resetear MFA');
    } finally {
      setResetting(null);
    }
  };

  const remove = async (u) => {
    try {
      await api.delete(`/admin/users/${u.id}`);
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Error al eliminar');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">Usuarios</h3>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Icon name="userPlus" size={13} /> Agregar
        </Button>
      </div>

      {error && <p className="text-rust text-xs mb-3 bg-rust-soft px-3 py-2 rounded-lg">{error}</p>}

      {!users ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12" />)}</div>
      ) : users.length === 0 ? (
        <EmptyState icon="users" title="Sin usuarios" hint="Agrega el primer miembro de esta organización." />
      ) : (
        <div className="bg-surface rounded-xl border border-line-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint border-b border-line-soft bg-paper-deep/40">
                <th className="px-3 py-2.5 font-semibold">Nombre</th>
                <th className="px-3 py-2.5 font-semibold">Rol</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5 font-semibold">MFA</th>
                <th className="px-3 py-2.5 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line-soft last:border-0 hover:bg-paper-deep/30 transition">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink text-xs">
                      {u.name} {u.id === me?.id && <span className="text-ink-faint font-normal">(tú)</span>}
                    </p>
                    <p className="text-xs text-ink-faint font-mono">{u.email}</p>
                  </td>
                  <td className="px-3 py-2.5"><RoleBadge role={u.role} /></td>
                  <td className="px-3 py-2.5"><StatusBadge active={u.isActive} /></td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-ink-soft">
                      {u.mfaEnabled ? '✓ Activo' : u.mfaEnforced ? 'Pendiente' : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" title="Editar" onClick={() => setEditing(u)}>
                        <Icon name="pencil" size={13} />
                      </Button>
                      {u.id !== me?.id && (
                        <>
                          <Button variant="ghost" size="sm"
                            title={u.isActive ? 'Desactivar' : 'Activar'}
                            onClick={() => patch(u, { isActive: !u.isActive })}>
                            <Icon name={u.isActive ? 'lock' : 'check'} size={13} />
                          </Button>
                          {u.mfaEnabled && (
                            <Button variant="ghost" size="sm" title="Resetear MFA" onClick={() => setResetting(u)}>
                              <Icon name="refresh" size={13} />
                            </Button>
                          )}
                          <Button variant="danger" size="sm" title="Eliminar" onClick={() => setDeleting(u)}>
                            <Icon name="trash" size={13} />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          orgId={org.id}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            if (editing === 'new') setUsers((list) => [...(list || []), u]);
            else replaceUser(u);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal title="Eliminar cuenta"
          message={`Se eliminará la cuenta de ${deleting.name} junto con sus reportes. Esta acción no se puede deshacer.`}
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)} />
      )}
      {resetting && (
        <ConfirmModal title="Resetear MFA"
          message={`${resetting.name} volverá a entrar solo con contraseña${resetting.mfaEnforced ? ' y deberá configurar MFA de nuevo' : ''}.`}
          confirmLabel="Resetear"
          onConfirm={() => resetMfa(resetting)}
          onClose={() => setResetting(null)} />
      )}
    </div>
  );
}

// ── Panel: Áreas de la org ────────────────────────────────────────

function OrgAreasPanel({ org }) {
  const [areas, setAreas] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [expandedArea, setExpandedArea] = useState(null);
  const [areaMembers, setAreaMembers] = useState({});
  const [orgUsers, setOrgUsers] = useState([]);
  const [addingTo, setAddingTo] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingLoading, setAddingLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/admin/orgs/${org.id}/areas`)
      .then(({ data }) => setAreas(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudo cargar áreas'));
  }, [org.id]);

  useEffect(() => {
    load();
    api.get(`/admin/users?orgId=${org.id}`)
      .then(({ data }) => setOrgUsers(data))
      .catch(() => {});
  }, [load, org.id]);

  const loadMembers = async (areaId) => {
    if (areaMembers[areaId]) return;
    try {
      const { data } = await api.get(`/areas/${areaId}/members`);
      setAreaMembers((m) => ({ ...m, [areaId]: data }));
    } catch {
      setAreaMembers((m) => ({ ...m, [areaId]: [] }));
    }
  };

  const toggleArea = (areaId) => {
    if (expandedArea === areaId) { setExpandedArea(null); return; }
    setExpandedArea(areaId);
    loadMembers(areaId);
  };

  const removeArea = async (area) => {
    try {
      await api.delete(`/admin/orgs/${org.id}/areas/${area.id}`);
      setAreas((list) => list.filter((a) => a.id !== area.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Error al eliminar área');
    } finally {
      setDeleting(null);
    }
  };

  const removeMember = async (areaId, userId) => {
    try {
      await api.delete(`/areas/${areaId}/members/${userId}`);
      setAreaMembers((m) => ({ ...m, [areaId]: m[areaId].filter((x) => x.userId !== userId) }));
      setAreas((list) => list.map((a) => a.id === areaId
        ? { ...a, _count: { ...a._count, members: a._count.members - 1 } } : a));
    } catch (err) {
      setError(err.response?.data?.error || 'Error al remover miembro');
    }
  };

  const addMember = async (areaId) => {
    if (!selectedUserId) return;
    setAddingLoading(true);
    try {
      const { data: member } = await api.post(`/areas/${areaId}/members`, { userId: selectedUserId });
      setAreaMembers((m) => ({ ...m, [areaId]: [...(m[areaId] || []), member] }));
      setAreas((list) => list.map((a) => a.id === areaId
        ? { ...a, _count: { ...a._count, members: a._count.members + 1 } } : a));
      setAddingTo(null);
      setSelectedUserId('');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al agregar miembro');
    } finally {
      setAddingLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">Áreas</h3>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={13} /> Nueva área
        </Button>
      </div>

      {error && <p className="text-rust text-xs mb-3 bg-rust-soft px-3 py-2 rounded-lg">{error}</p>}

      {!areas ? (
        <div className="space-y-2">{[1,2].map(i => <div key={i} className="skeleton h-14" />)}</div>
      ) : areas.length === 0 ? (
        <EmptyState icon="layers" title="Sin áreas" hint="Crea áreas para organizar equipos y datasets." />
      ) : (
        <div className="space-y-2">
          {areas.map((area) => (
            <div key={area.id} className="bg-surface rounded-xl border border-line-soft overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => toggleArea(area.id)}
                  className="flex items-center gap-2 text-sm font-medium text-ink hover:text-lumen-deep transition text-left flex-1"
                >
                  <Icon name={expandedArea === area.id ? 'chevronDown' : 'chevronRight'} size={14} className="text-ink-faint" />
                  <Icon name="layers" size={15} className="text-lumen-deep" />
                  {area.name}
                  <span className="text-xs text-ink-faint font-normal font-mono ml-1">
                    {area._count.members} miembro{area._count.members !== 1 ? 's' : ''} · {area._count.datasets} datasets · {area._count.reports} reportes
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(area)}>
                    <Icon name="pencil" size={13} />
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleting(area)}>
                    <Icon name="trash" size={13} />
                  </Button>
                </div>
              </div>

              {expandedArea === area.id && (
                <div className="border-t border-line-soft px-4 py-3 bg-paper-deep/30">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Miembros</p>
                    {addingTo !== area.id && (
                      <button
                        onClick={() => { setAddingTo(area.id); setSelectedUserId(''); setError(''); }}
                        className="flex items-center gap-1 text-xs text-lumen-deep hover:text-lumen transition cursor-pointer"
                      >
                        <Icon name="userPlus" size={12} /> Agregar
                      </button>
                    )}
                  </div>

                  {addingTo === area.id && (
                    <div className="flex items-center gap-2 mb-3">
                      <select
                        className="field field-sm flex-1 text-xs"
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                      >
                        <option value="">— Seleccionar usuario —</option>
                        {orgUsers
                          .filter((u) => !(areaMembers[area.id] || []).some((m) => m.userId === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                          ))}
                      </select>
                      <Button size="sm" disabled={!selectedUserId || addingLoading} onClick={() => addMember(area.id)}>
                        {addingLoading ? '…' : 'Agregar'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAddingTo(null); setSelectedUserId(''); }}>
                        Cancelar
                      </Button>
                    </div>
                  )}

                  {!areaMembers[area.id] ? (
                    <div className="skeleton h-8" />
                  ) : areaMembers[area.id].length === 0 ? (
                    <p className="text-xs text-ink-faint">Sin miembros asignados.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {areaMembers[area.id].map((m) => (
                        <div key={m.id} className="flex items-center gap-1.5 bg-surface border border-line-soft rounded-lg px-2.5 py-1 text-xs">
                          <span className="text-ink font-medium">{m.user.name}</span>
                          <span className="text-ink-faint">{m.user.email}</span>
                          <button
                            onClick={() => removeMember(area.id, m.userId)}
                            className="text-ink-faint hover:text-rust transition ml-1 cursor-pointer"
                            title="Remover del área"
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AreaModal
          area={editing === 'new' ? null : editing}
          orgId={org.id}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            if (editing === 'new') setAreas((list) => [...(list || []), a]);
            else setAreas((list) => list.map((x) => (x.id === a.id ? a : x)));
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal title="Eliminar área"
          message={`¿Eliminar el área "${deleting.name}"? Los datasets y reportes del área serán desvinculados.`}
          onConfirm={() => removeArea(deleting)}
          onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

// ── Panel: Reportes de la org (vista superadmin) ──────────────────

function OrgReportsPanel({ org }) {
  const [reports, setReports] = useState(null);
  const [areas, setAreas] = useState([]);
  const [search, setSearch] = useState('');
  const [movingReport, setMovingReport] = useState(null);
  const [targetAreaId, setTargetAreaId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/admin/orgs/${org.id}/reports`)
      .then(({ data }) => setReports(data))
      .catch(() => setError('No se pudo cargar reportes'));
    api.get(`/admin/orgs/${org.id}/areas`)
      .then(({ data }) => setAreas(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [org.id]);

  const transferArea = async () => {
    try {
      await api.patch(`/admin/reports/${movingReport.id}`, { areaId: targetAreaId || null });
      const areaObj = areas.find((a) => a.id === targetAreaId) || null;
      setReports((prev) => prev.map((r) =>
        r.id === movingReport.id ? { ...r, area: areaObj } : r
      ));
      setMovingReport(null);
      setTargetAreaId('');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al mover reporte');
    }
  };

  const filtered = reports
    ? reports.filter((r) =>
        !search.trim() ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.owner?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">Reportes</h3>
        {reports && <span className="text-xs text-ink-faint font-mono">{reports.length} total</span>}
      </div>

      {reports && reports.length > 0 && (
        <div className="relative mb-4">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título o autor…" className="field field-sm w-full pl-8" />
        </div>
      )}

      {error && <p className="text-rust text-xs mb-3 bg-rust-soft px-3 py-2 rounded-lg">{error}</p>}

      {!filtered ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-10" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="chart" title="Sin reportes" hint="Esta organización aún no tiene reportes." />
      ) : (
        <div className="bg-surface rounded-xl border border-line-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint border-b border-line-soft bg-paper-deep/40">
                <th className="px-3 py-2.5 font-semibold">Reporte</th>
                <th className="px-3 py-2.5 font-semibold">Autor</th>
                <th className="px-3 py-2.5 font-semibold">Área</th>
                <th className="px-3 py-2.5 font-semibold">Widgets</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-paper-deep/30">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink text-xs">{r.title}</p>
                    {r.description && <p className="text-xs text-ink-faint truncate max-w-48">{r.description}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-soft">{r.owner?.name}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => { setMovingReport(r); setTargetAreaId(r.area?.id || ''); }}
                      className="group flex items-center gap-1 cursor-pointer"
                      title="Clic para mover a otra área"
                    >
                      {r.area
                        ? <span className="text-xs bg-lumen-soft text-lumen-deep px-2 py-0.5 rounded-full group-hover:bg-lumen/20 transition">{r.area.name}</span>
                        : <span className="text-xs text-ink-faint group-hover:text-ink-soft transition">Privado</span>
                      }
                      <Icon name="pencil" size={10} className="text-ink-faint opacity-0 group-hover:opacity-100 transition" />
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-ink-faint">{r._count.widgets}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      <Link to={`/report/${r.id}/view`}
                        className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-lumen-deep transition px-1.5 py-1 rounded-lg hover:bg-lumen-soft"
                        title="Ver reporte">
                        <Icon name="eye" size={13} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {movingReport && (
        <Modal title={`Mover reporte: ${movingReport.title}`} onClose={() => setMovingReport(null)} maxWidth="max-w-sm">
          <p className="text-sm text-ink-soft mb-4">Asigna este reporte a otra área de la organización.</p>
          <Field label="Área destino">
            <select className="field" value={targetAreaId} onChange={(e) => setTargetAreaId(e.target.value)}>
              <option value="">Sin área (privado)</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="soft" onClick={() => setMovingReport(null)}>Cancelar</Button>
            <Button onClick={transferArea}>Mover</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Panel: Plantillas base (superadmin) ──────────────────────────

// ── Super admins ──────────────────────────────────────────────────

function SuperAdminsPanel({ me }) {
  const [admins, setAdmins] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const load = useCallback(async () => {
    const { data } = await api.get('/admin/users');
    setAdmins(data.filter((u) => u.role === 'superadmin'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/admin/users', { ...form, role: 'superadmin' });
      setAddOpen(false);
      setForm({ name: '', email: '', password: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (admin) => {
    try {
      await api.patch(`/admin/users/${admin.id}`, { isActive: !admin.isActive });
      setAdmins((list) => list.map((a) => a.id === admin.id ? { ...a, isActive: !admin.isActive } : a));
    } finally {
      setDeactivating(null);
    }
  };

  const resetMfa = async (admin) => {
    await api.post(`/admin/users/${admin.id}/mfa/reset`);
    setAdmins((list) => list.map((a) => a.id === admin.id ? { ...a, mfaEnabled: false } : a));
  };

  if (!admins) return <div className="skeleton h-48 rounded-2xl" />;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setAddOpen(true); setError(''); }}>
          <Icon name="userPlus" size={15} /> Nuevo super admin
        </Button>
      </div>

      <div className="divide-y divide-line-soft border border-line rounded-xl overflow-hidden">
        {admins.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-faint text-center">Sin super admins registrados.</p>
        )}
        {admins.map((admin) => (
          <div key={admin.id} className="px-4 py-3 flex items-center gap-3 bg-surface">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink truncate flex items-center gap-2">
                {admin.name}
                {admin.id === me?.id && (
                  <span className="text-xs text-lumen-deep bg-lumen-soft px-1.5 py-0.5 rounded-full">Tú</span>
                )}
              </p>
              <p className="text-xs text-ink-faint font-mono truncate">{admin.email}</p>
            </div>
            <div className="flex items-center gap-2">
              {admin.mfaEnabled && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-sea-soft text-sea font-medium">MFA</span>
              )}
              <StatusBadge active={admin.isActive} />
            </div>
            {admin.id !== me?.id && (
              <div className="flex items-center gap-1 shrink-0">
                {admin.mfaEnabled && (
                  <Button variant="ghost" size="sm" title="Resetear MFA" onClick={() => resetMfa(admin)}>
                    <Icon name="shield" size={13} />
                  </Button>
                )}
                <Button
                  variant={admin.isActive ? 'danger' : 'soft'}
                  size="sm"
                  onClick={() => setDeactivating(admin)}
                >
                  {admin.isActive ? 'Desactivar' : 'Activar'}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {addOpen && (
        <Modal title="Nuevo super admin" onClose={() => setAddOpen(false)}>
          <form onSubmit={create} className="space-y-4">
            <Field label="Nombre">
              <input className="field" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Correo electrónico">
              <input className="field" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
            </Field>
            <Field label="Contraseña">
              <input className="field" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={8} />
            </Field>
            {error && <p className="text-xs text-rust">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setAddOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creando…' : 'Crear super admin'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {deactivating && (
        <ConfirmModal
          title={deactivating.isActive ? 'Desactivar super admin' : 'Activar super admin'}
          message={`¿${deactivating.isActive ? 'Desactivar' : 'Activar'} la cuenta de ${deactivating.name}?`}
          confirmLabel={deactivating.isActive ? 'Desactivar' : 'Activar'}
          onConfirm={() => toggleActive(deactivating)}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}

// ── Modal de motivo para cambios administrativos ──────────────────

function OrgReasonModal({ title, description, confirmLabel = 'Confirmar', onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { setErr('El motivo es obligatorio'); return; }
    setBusy(true); setErr('');
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (error) {
      setErr(error.response?.data?.error ?? 'Error al guardar');
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      {description && <p className="text-sm text-ink-soft mb-4">{description}</p>}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-ink-soft uppercase tracking-widest block mb-1">
            Motivo del cambio <span className="text-rust">*</span>
          </label>
          <textarea
            className="field text-sm resize-none"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe la razón de este cambio…"
            autoFocus
          />
        </div>
        {err && <p className="text-xs text-rust">{err}</p>}
        <div className="flex justify-end gap-2 mt-1">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancelar</Button>
          <Button size="sm" type="submit" disabled={busy || !reason.trim()}>
            {busy ? 'Guardando…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Selector de plan para org ─────────────────────────────────────

function OrgPlanSelector({ org, onChanged }) {
  const [plans, setPlans] = useState(null);
  const [pendingPlanId, setPendingPlanId] = useState(null); // valor seleccionado esperando motivo

  useEffect(() => {
    api.get('/admin/plans').then(({ data }) => setPlans(data)).catch(() => {});
  }, []);

  const confirmAssign = async (reason) => {
    const { data } = await api.patch(`/admin/orgs/${org.id}/plan`, { planId: pendingPlanId || null, reason });
    onChanged({ id: org.id, planId: data.planId, plan: data.plan });
  };

  if (!plans) return null;

  const pendingPlan = plans.find((p) => p.id === pendingPlanId);

  return (
    <>
      <div className="shrink-0 w-36">
        <select
          className="field field-sm text-xs"
          value={org.planId ?? ''}
          onChange={(e) => setPendingPlanId(e.target.value || null)}
          title="Plan asignado"
        >
          <option value="">Sin plan</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {pendingPlanId !== null && (
        <OrgReasonModal
          title="Cambiar plan"
          description={`Cambiarás el plan de "${org.name}" a "${pendingPlan?.name ?? 'Sin plan'}". Este cambio quedará registrado.`}
          confirmLabel="Cambiar plan"
          onConfirm={confirmAssign}
          onClose={() => setPendingPlanId(null)}
        />
      )}
    </>
  );
}

// ── Planes ────────────────────────────────────────────────────────

function PlanModal({ plan, onSaved, onClose }) {
  const isNew = !plan;
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    retentionDays: plan?.retentionDays ?? 30,
    maxUsers: plan?.maxUsers ?? '',
    storageLimitMB: plan?.storageLimitMB ?? '',
    allowPublicLinks: plan?.allowPublicLinks ?? true,
    allowExternalShare: plan?.allowExternalShare ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => setForm((f) => ({ ...f, [k]: !f[k] }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      retentionDays: Number(form.retentionDays),
      maxUsers: form.maxUsers !== '' ? Number(form.maxUsers) : null,
      storageLimitMB: form.storageLimitMB !== '' ? Number(form.storageLimitMB) : null,
      allowPublicLinks: form.allowPublicLinks,
      allowExternalShare: form.allowExternalShare,
    };
    try {
      const { data } = isNew
        ? await api.post('/admin/plans', payload)
        : await api.patch(`/admin/plans/${plan.id}`, payload);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Nuevo plan' : `Editar: ${plan.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre del plan">
          <input className="field" value={form.name} onChange={set('name')} required placeholder="consumer, enterprise, custom…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Retención (días)">
            <input className="field" type="number" min={1} value={form.retentionDays} onChange={set('retentionDays')} required />
          </Field>
          <Field label="Máx. usuarios (vacío = ∞)">
            <input className="field" type="number" min={1} value={form.maxUsers} onChange={set('maxUsers')} placeholder="∞" />
          </Field>
        </div>
        <Field label="Límite storage en MB (vacío = ∞)">
          <input className="field" type="number" min={1} value={form.storageLimitMB} onChange={set('storageLimitMB')} placeholder="∞" />
        </Field>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.allowPublicLinks} onChange={() => toggle('allowPublicLinks')} />
            <span className="text-sm text-ink">Permitir enlaces públicos</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.allowExternalShare} onChange={() => toggle('allowExternalShare')} />
            <span className="text-sm text-ink">Permitir compartir externo</span>
          </label>
        </div>
        {error && <p className="text-xs text-rust">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : isNew ? 'Crear' : 'Guardar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PlansPanel({ orgs }) {
  const [plans, setPlans] = useState(null);
  const [editPlan, setEditPlan] = useState(null);
  const [deletingPlan, setDeletingPlan] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/plans')
      .then(({ data }) => setPlans(data))
      .catch(() => setError('No se pudieron cargar los planes'));
  }, []);

  const deletePlan = async (plan) => {
    try {
      await api.delete(`/admin/plans/${plan.id}`);
      setPlans((list) => list.filter((p) => p.id !== plan.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Error al eliminar');
    } finally {
      setDeletingPlan(null);
    }
  };

  if (!plans) return <div className="skeleton h-48 rounded-2xl" />;

  return (
    <div>
      {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}
      <div className="flex justify-end mb-4">
        <Button onClick={() => setEditPlan(true)}>
          <Icon name="plus" size={15} /> Nuevo plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState icon="layers" title="Sin planes" hint="Crea planes para asignar límites y permisos a las organizaciones.">
          <Button onClick={() => setEditPlan(true)}><Icon name="plus" size={15} /> Crear plan</Button>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-surface border border-line rounded-xl p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-ink">{plan.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-lumen-soft text-lumen-deep font-mono">
                    {orgs?.filter((o) => o.planId === plan.id).length ?? 0} org(s)
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
                  <span>Retención: <span className="text-ink">{plan.retentionDays}d</span></span>
                  <span>Usuarios: <span className="text-ink">{plan.maxUsers ?? '∞'}</span></span>
                  <span>Storage: <span className="text-ink">{plan.storageLimitMB ? `${plan.storageLimitMB} MB` : '∞'}</span></span>
                  {!plan.allowPublicLinks && <span className="text-rust">Sin links públicos</span>}
                  {!plan.allowExternalShare && <span className="text-rust">Sin compartir externo</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditPlan(plan)}>
                  <Icon name="pencil" size={13} />
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDeletingPlan(plan)}>
                  <Icon name="trash" size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editPlan && (
        <PlanModal
          plan={editPlan === true ? null : editPlan}
          onClose={() => setEditPlan(null)}
          onSaved={(saved) => {
            if (editPlan === true) setPlans((list) => [...list, saved]);
            else setPlans((list) => list.map((p) => (p.id === saved.id ? saved : p)));
            setEditPlan(null);
          }}
        />
      )}
      {deletingPlan && (
        <ConfirmModal
          title="Eliminar plan"
          message={`¿Eliminar el plan "${deletingPlan.name}"? Las organizaciones asignadas perderán su plan.`}
          confirmLabel="Eliminar"
          onConfirm={() => deletePlan(deletingPlan)}
          onCancel={() => setDeletingPlan(null)}
        />
      )}
    </div>
  );
}

function TemplatesPanel({ orgs }) {
  const [templates, setTemplates] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null); // template being assigned
  const [assignOrgId, setAssignOrgId] = useState('');
  const [orgUsers, setOrgUsers] = useState([]);
  const [orgAreas, setOrgAreas] = useState([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignAreaId, setAssignAreaId] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/admin/reports/templates')
      .then(({ data }) => setTemplates(data))
      .catch(() => setError('No se pudieron cargar plantillas'));
  }, []);

  useEffect(() => {
    if (!assignOrgId) return;
    let active = true;
    Promise.all([
      api.get(`/admin/users?orgId=${assignOrgId}`),
      api.get(`/admin/orgs/${assignOrgId}/areas`),
    ]).then(([{ data: users }, { data: areas }]) => {
      if (!active) return;
      setOrgUsers(users);
      setAssignUserId(users[0]?.id || '');
      setOrgAreas(areas);
      setAssignAreaId(areas[0]?.id || '');
    }).catch(() => { if (active) { setOrgUsers([]); setOrgAreas([]); } })
      .finally(() => { if (active) setLoadingUsers(false); });
    return () => { active = false; };
  }, [assignOrgId]);

  const createTemplate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post('/admin/reports/templates', { title: newTitle.trim() });
      setTemplates((prev) => [data, ...(prev || [])]);
      setNewTitle('');
      navigate(`/report/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear');
    } finally {
      setCreating(false);
    }
  };

  const deleteTemplate = async (t) => {
    if (!window.confirm(`¿Eliminar plantilla "${t.title}"?`)) return;
    try {
      await api.delete(`/reports/${t.id}`);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch {
      setError('Error al eliminar');
    }
  };

  const startAssign = (t) => {
    setAssignTarget(t);
    setAssignOrgId(orgs[0]?.id || '');
    setOrgUsers([]);
    setOrgAreas([]);
    setAssignUserId('');
    setAssignAreaId('');
    setLoadingUsers(true);
    setError('');
    setSuccess('');
  };

  const confirmAssign = async () => {
    if (!assignUserId || !assignAreaId) return;
    setAssignLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/admin/reports/${assignTarget.id}/assign`, { userId: assignUserId, areaId: assignAreaId });
      const user = orgUsers.find((u) => u.id === assignUserId);
      const org = orgs.find((o) => o.id === assignOrgId);
      const dsMsg = data.datasetsCloned > 0 ? ` · ${data.datasetsCloned} dataset(s) clonado(s) sin credenciales` : '';
      setSuccess(`Plantilla "${assignTarget.title}" asignada a ${user?.name} (${org?.name})${dsMsg}`);
      setAssignTarget(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al asignar');
    } finally {
      setAssignLoading(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl border border-line-soft overflow-hidden animate-rise">
      <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg text-ink flex items-center gap-2">
            <Icon name="copy" size={17} className="text-lumen-deep" /> Plantillas base
          </h2>
          <p className="text-xs text-ink-faint mt-0.5">Reportes modelo que puedes clonar a cualquier cliente.</p>
        </div>
      </div>

      <div className="p-5">
        {error && <p className="text-rust text-xs mb-3 bg-rust-soft px-3 py-2 rounded-lg">{error}</p>}
        {success && <p className="text-sea text-xs mb-3 bg-sea-soft px-3 py-2 rounded-lg">{success}</p>}

        <form onSubmit={createTemplate} className="flex gap-2 mb-6">
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nombre de la nueva plantilla…" className="field flex-1" />
          <Button type="submit" disabled={creating || !newTitle.trim()}>
            <Icon name="plus" size={14} /> Crear y editar
          </Button>
        </form>

        {!templates ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12" />)}</div>
        ) : templates.length === 0 ? (
          <EmptyState icon="copy" title="Sin plantillas"
            hint="Crea una plantilla, diseña el dashboard en el editor y luego asígnala a tus clientes." />
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id}
                className="flex items-center gap-3 px-4 py-3 bg-paper-deep/40 border border-line-soft rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{t.title}</p>
                  {t.description && <p className="text-xs text-ink-faint truncate">{t.description}</p>}
                  <p className="text-xs text-ink-faint font-mono mt-0.5">
                    {t._count?.pages ?? 0} páginas · {t._count?.widgets ?? 0} widgets
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Link to={`/report/${t.id}`}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg text-ink-soft hover:text-ink hover:bg-paper-deep transition">
                    <Icon name="pencil" size={13} /> Editar
                  </Link>
                  <Button size="sm" variant="accent" onClick={() => startAssign(t)}>
                    <Icon name="users" size={13} /> Asignar a cliente
                  </Button>
                  <button onClick={() => deleteTemplate(t)}
                    className="p-1.5 rounded-lg text-ink-faint hover:text-rust hover:bg-rust-soft transition cursor-pointer"
                    title="Eliminar plantilla">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {assignTarget && (
        <Modal title={`Asignar: ${assignTarget.title}`} onClose={() => setAssignTarget(null)} maxWidth="max-w-sm">
          <div className="text-sm text-ink-soft mb-4 space-y-2">
            <p>Se creará una copia del reporte en la cuenta del usuario seleccionado.</p>
            <ul className="text-xs text-ink-faint space-y-1 border border-line-soft rounded-lg px-3 py-2.5 bg-paper-deep/40">
              <li>· Los <strong className="text-ink">datasets API/DB</strong> se clonan en el área destino, sin credenciales.</li>
              <li>· Los datasets con <strong className="text-ink">slot</strong> quedan pendientes — el usuario los vincula desde Datasets.</li>
              <li>· Los datasets <strong className="text-ink">CSV/Excel</strong> no se transfieren — el usuario debe subir su propio archivo.</li>
              <li>· El usuario se agrega automáticamente al área destino si aún no es miembro.</li>
            </ul>
          </div>
          <div className="space-y-4">
            <Field label="Organización cliente">
              <select className="field" value={assignOrgId} onChange={(e) => setAssignOrgId(e.target.value)}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            {loadingUsers ? (
              <div className="skeleton h-10" />
            ) : (
              <>
                <Field label="Área destino"
                  hint="Los datasets clonados quedarán en esta área. El usuario también se agregará como miembro si aún no lo es.">
                  <select className="field" value={assignAreaId} onChange={(e) => setAssignAreaId(e.target.value)}>
                    <option value="">— Seleccionar área —</option>
                    {orgAreas.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Asignar a usuario">
                  <select className="field" value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {orgUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
          </div>
          {error && <p className="text-rust text-xs mt-3 bg-rust-soft px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="soft" onClick={() => setAssignTarget(null)}>Cancelar</Button>
            <Button onClick={confirmAssign} disabled={!assignUserId || !assignAreaId || assignLoading}>
              {assignLoading ? 'Asignando…' : 'Confirmar asignación'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Almacenamiento ────────────────────────────────────────────────

function StoragePanel() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [confirmTypes, setConfirmTypes] = useState(null);
  const [result, setResult] = useState(null);

  const load = useCallback(() => {
    setError('');
    api.get('/admin/storage/stats')
      .then(({ data }) => setStats(data))
      .catch(() => setError('No se pudo cargar estadísticas de almacenamiento'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const runCleanup = async (types) => {
    setCleaning(true); setError('');
    try {
      const { data } = await api.delete('/admin/storage/cleanup', { data: { types } });
      setResult(data.deleted);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al limpiar');
    } finally {
      setCleaning(false);
      setConfirmTypes(null);
    }
  };

  if (!stats) return <div className="skeleton h-48 rounded-2xl" />;

  const TYPE_LABELS = { db: 'conectores DB', orphan: 'huérfanas' };

  return (
    <div className="bg-surface rounded-2xl border border-line-soft overflow-hidden animate-rise">
      <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-ink flex items-center gap-2">
            <Icon name="database" size={17} className="text-lumen-deep" /> Almacenamiento
          </h2>
          <p className="text-xs text-ink-faint mt-0.5">
            Filas guardadas por tipo de fuente. Los conectores de base de datos ya no cachean filas —
            se pueden limpiar sin afectar el funcionamiento.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          <Icon name="refresh" size={13} /> Recargar
        </Button>
      </div>

      <div className="p-5 space-y-5">
        {error && <p className="text-rust text-xs bg-rust-soft px-3 py-2 rounded-lg">{error}</p>}
        {result && (
          <p className="text-sea text-xs bg-sea-soft px-3 py-2 rounded-lg">
            Limpieza completa — {Object.entries(result).map(([k, v]) => `${TYPE_LABELS[k] || k}: ${v.toLocaleString()}`).join(' · ')} filas eliminadas.
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-paper-deep/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-display text-ink">{stats.total.toLocaleString()}</p>
            <p className="text-xs text-ink-faint">Total filas</p>
          </div>
          <div className="bg-paper-deep/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-display text-ink">{stats.byType.db.toLocaleString()}</p>
            <p className="text-xs text-ink-faint">Conectores DB</p>
          </div>
          <div className="bg-paper-deep/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-display text-ink">{stats.byType.api.toLocaleString()}</p>
            <p className="text-xs text-ink-faint">API</p>
          </div>
          <div className="bg-paper-deep/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-display text-ink">{stats.byType.file.toLocaleString()}</p>
            <p className="text-xs text-ink-faint">Archivos</p>
          </div>
        </div>

        {stats.byType.orphan > 0 && (
          <p className="text-xs text-rust bg-rust-soft px-3 py-2 rounded-lg">
            {stats.byType.orphan.toLocaleString()} fila{stats.byType.orphan !== 1 ? 's' : ''} huérfana{stats.byType.orphan !== 1 ? 's' : ''} (sin dataset dueño).
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-line-soft">
          <Button variant="danger" size="sm" disabled={!stats.byType.db} onClick={() => setConfirmTypes(['db'])}>
            <Icon name="trash" size={13} /> Limpiar conectores DB ({stats.byType.db.toLocaleString()})
          </Button>
          <Button variant="danger" size="sm" disabled={!stats.byType.orphan} onClick={() => setConfirmTypes(['orphan'])}>
            <Icon name="trash" size={13} /> Limpiar huérfanas ({stats.byType.orphan.toLocaleString()})
          </Button>
          <Button variant="danger" size="sm" disabled={!stats.byType.db && !stats.byType.orphan}
            onClick={() => setConfirmTypes(['db', 'orphan'])}>
            <Icon name="trash" size={13} /> Limpiar todo
          </Button>
        </div>
      </div>

      {confirmTypes && (
        <ConfirmModal
          title="Limpiar almacenamiento"
          message={`Se eliminarán permanentemente las filas de tipo: ${confirmTypes.map(t => TYPE_LABELS[t] || t).join(', ')}. Esta acción no se puede deshacer.`}
          confirmLabel={cleaning ? 'Limpiando…' : 'Limpiar'}
          onConfirm={() => runCleanup(confirmTypes)}
          onClose={() => setConfirmTypes(null)}
        />
      )}
    </div>
  );
}

// ── Página principal Admin ─────────────────────────────────────────

const ORG_TABS = [
  { id: 'users', label: 'Usuarios', icon: 'users' },
  { id: 'areas', label: 'Áreas', icon: 'layers' },
  { id: 'reports', label: 'Reportes', icon: 'chart' },
  { id: 'audit', label: 'Auditoría', icon: 'shield' },
];

function OrgAuditPanel({ org }) {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    api.get(`/admin/orgs/${org.id}/audit`)
      .then(({ data }) => setLogs(data))
      .catch(() => setLogs([]));
  }, [org.id]);

  const ACTION_LABELS = {
    plan_changed: 'Cambio de plan',
    status_changed: 'Cambio de estado',
  };

  if (!logs) return <div className="skeleton h-24" />;
  if (logs.length === 0) return (
    <p className="text-sm text-ink-faint text-center py-8">Sin cambios registrados aún.</p>
  );

  return (
    <ul className="divide-y divide-line-soft">
      {logs.map((log) => (
        <li key={log.id} className="py-3 flex gap-3">
          <span className="grid place-items-center w-7 h-7 rounded-full bg-lumen-soft text-lumen-deep text-xs font-semibold shrink-0 mt-0.5">
            {log.admin.name?.[0]?.toUpperCase() ?? '?'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-ink">{ACTION_LABELS[log.action] ?? log.action}</span>
              {log.oldValue && (
                <span className="text-xs text-ink-faint">
                  <span className="line-through">{log.oldValue}</span>
                  {log.newValue && <> → <span className="text-ink">{log.newValue}</span></>}
                </span>
              )}
            </div>
            <p className="text-xs text-ink-soft mt-0.5 italic">"{log.reason}"</p>
            <p className="text-xs text-ink-faint mt-0.5">
              {log.admin.name} · {new Date(log.createdAt).toLocaleString('es-CL')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Admin() {
  const { user: me } = useAuthStore();
  const [view, setView] = useState('orgs'); // 'orgs' | 'templates'
  const [orgs, setOrgs] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [activeTab, setActiveTab] = useState('users');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/orgs')
      .then(({ data }) => {
        setOrgs(data);
        if (data.length > 0 && !selectedOrg) setSelectedOrg(data[0]);
      })
      .catch(() => setError('No se pudo cargar organizaciones'));
  }, []);

  if (me && me.role !== 'superadmin') return <Navigate to="/" replace />;

  const removeOrg = async (org) => {
    try {
      await api.delete(`/admin/orgs/${org.id}`);
      setOrgs((list) => list.filter((o) => o.id !== org.id));
      if (selectedOrg?.id === org.id) setSelectedOrg(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al eliminar');
    } finally {
      setDeletingOrg(null);
    }
  };

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl text-ink flex items-center gap-2">
              <Icon name="shield" size={22} className="text-lumen-deep" /> Administración
            </h1>
            <p className="text-sm text-ink-faint mt-1">Gestiona organizaciones, equipos y usuarios.</p>
          </div>
          {view === 'orgs' && (
            <Button onClick={() => setCreatingOrg(true)}>
              <Icon name="plus" size={15} /> Nueva organización
            </Button>
          )}
        </div>

        {/* Vista principal: Organizaciones / Plantillas / Planes / Super admins */}
        <div className="flex gap-1 p-1 bg-paper-deep rounded-xl border border-line-soft mb-6 w-fit flex-wrap">
          {[
            { id: 'orgs', label: 'Organizaciones', icon: 'building' },
            { id: 'templates', label: 'Plantillas base', icon: 'copy' },
            { id: 'plans', label: 'Planes', icon: 'layers' },
            { id: 'superadmins', label: 'Super admins', icon: 'shield' },
            { id: 'storage', label: 'Almacenamiento', icon: 'database' },
          ].map((v) => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                view === v.id
                  ? 'bg-surface text-ink shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}>
              <Icon name={v.icon} size={14} /> {v.label}
            </button>
          ))}
        </div>

        {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}

        {view === 'templates' && orgs && <TemplatesPanel orgs={orgs} />}
        {view === 'templates' && !orgs && <div className="skeleton h-48 rounded-2xl" />}
        {view === 'plans' && <PlansPanel orgs={orgs} />}
        {view === 'superadmins' && <SuperAdminsPanel me={me} />}
        {view === 'storage' && <StoragePanel />}
        {view === 'orgs' && (<>

        {!orgs ? (
          <div className="grid grid-cols-4 gap-6">
            <div className="col-span-1 space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-16" />)}</div>
            <div className="col-span-3 skeleton h-64" />
          </div>
        ) : orgs.length === 0 ? (
          <EmptyState icon="building" title="Sin organizaciones"
            hint="Crea la primera organización para empezar a gestionar clientes.">
            <Button onClick={() => setCreatingOrg(true)}>
              <Icon name="plus" size={15} /> Crear organización
            </Button>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

            {/* Sidebar: lista de orgs */}
            <div className="lg:col-span-1 space-y-1.5">
              <p className="text-xs font-semibold text-ink-faint uppercase tracking-wide px-1 mb-2">Organizaciones</p>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => { setSelectedOrg(org); setActiveTab('users'); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition group ${
                    selectedOrg?.id === org.id
                      ? 'bg-lumen-soft border border-lumen/30 text-lumen-deep'
                      : 'hover:bg-paper-deep text-ink-soft hover:text-ink'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="building" size={14} className={selectedOrg?.id === org.id ? 'text-lumen-deep' : 'text-ink-faint'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{org.name}</p>
                      <p className="text-xs text-ink-faint font-mono truncate">{org._count?.memberships ?? 0}u · {org._count?.areas ?? 0}á</p>
                    </div>
                    {!org.isActive && <span className="w-1.5 h-1.5 rounded-full bg-rust shrink-0" title="Inactiva" />}
                  </div>
                </button>
              ))}
            </div>

            {/* Panel derecho */}
            <div className="lg:col-span-3">
              {!selectedOrg ? (
                <div className="bg-surface rounded-2xl border border-line-soft p-12 text-center">
                  <p className="text-ink-faint text-sm">Selecciona una organización</p>
                </div>
              ) : (
                <div className="bg-surface rounded-2xl border border-line-soft overflow-hidden animate-rise">
                  {/* Header del org */}
                  <div className="px-5 py-4 border-b border-line-soft flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-display text-lg text-ink">{selectedOrg.name}</h2>
                        <StatusBadge active={selectedOrg.isActive} />
                      </div>
                      <p className="text-xs text-ink-faint font-mono mt-0.5">slug: {selectedOrg.slug}</p>
                    </div>
                    <OrgPlanSelector
                      org={selectedOrg}
                      onChanged={(updated) => {
                        setOrgs((list) => list.map((o) => o.id === updated.id ? { ...o, ...updated } : o));
                        setSelectedOrg((prev) => prev?.id === updated.id ? { ...prev, ...updated } : prev);
                      }}
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        title={selectedOrg.isActive ? 'Desactivar organización' : 'Activar organización'}
                        onClick={() => setTogglingStatus(true)}
                      >
                        <Icon name={selectedOrg.isActive ? 'eye-off' : 'eye'} size={13} />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setCreatingOrg(selectedOrg)}>
                        <Icon name="pencil" size={13} />
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeletingOrg(selectedOrg)}>
                        <Icon name="trash" size={13} />
                      </Button>
                    </div>
                  </div>

                  {/* Sub-tabs */}
                  <div className="flex border-b border-line-soft px-2">
                    {ORG_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition ${
                          activeTab === tab.id
                            ? 'border-lumen-deep text-lumen-deep'
                            : 'border-transparent text-ink-soft hover:text-ink'
                        }`}
                      >
                        <Icon name={tab.icon} size={14} />
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Contenido del tab */}
                  <div className="p-5">
                    {activeTab === 'users' && <OrgUsersPanel key={selectedOrg.id} org={selectedOrg} me={me} />}
                    {activeTab === 'areas' && <OrgAreasPanel key={selectedOrg.id} org={selectedOrg} />}
                    {activeTab === 'reports' && <OrgReportsPanel key={selectedOrg.id} org={selectedOrg} />}
                    {activeTab === 'audit' && <OrgAuditPanel key={selectedOrg.id} org={selectedOrg} />}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        </>)}
      </main>

      {togglingStatus && selectedOrg && (
        <OrgReasonModal
          title={selectedOrg.isActive ? 'Desactivar organización' : 'Activar organización'}
          description={selectedOrg.isActive
            ? `Desactivarás "${selectedOrg.name}". Sus usuarios no podrán acceder mientras esté inactiva.`
            : `Activarás "${selectedOrg.name}". Sus usuarios recuperarán el acceso.`}
          confirmLabel={selectedOrg.isActive ? 'Desactivar' : 'Activar'}
          onConfirm={async (reason) => {
            const { data } = await api.patch(`/admin/orgs/${selectedOrg.id}/status`, { reason });
            setOrgs((list) => list.map((o) => o.id === data.id ? { ...o, isActive: data.isActive } : o));
            setSelectedOrg((prev) => prev?.id === data.id ? { ...prev, isActive: data.isActive } : prev);
          }}
          onClose={() => setTogglingStatus(false)}
        />
      )}

      {creatingOrg && (
        <OrgModal
          org={creatingOrg === true ? null : creatingOrg}
          onClose={() => setCreatingOrg(false)}
          onSaved={(org) => {
            if (creatingOrg === true) {
              setOrgs((list) => [...(list || []), org]);
              setSelectedOrg(org);
            } else {
              setOrgs((list) => list.map((o) => (o.id === org.id ? { ...o, ...org } : o)));
              setSelectedOrg((prev) => (prev?.id === org.id ? { ...prev, ...org } : prev));
            }
            setCreatingOrg(false);
          }}
        />
      )}
      {deletingOrg && (
        <ConfirmModal title="Eliminar organización"
          message={`¿Eliminar "${deletingOrg.name}"? Se eliminarán todos sus usuarios, áreas, datasets y reportes. Acción irreversible.`}
          onConfirm={() => removeOrg(deletingOrg)}
          onClose={() => setDeletingOrg(null)} />
      )}
    </div>
  );
}
