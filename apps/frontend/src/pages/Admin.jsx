import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { AppHeader, Button, Field, Icon, Modal, ConfirmModal, EmptyState, SkeletonCards } from '../components/ui';

const ROLE_LABEL = { user: 'Usuario', superadmin: 'Super admin' };

function UserFormModal({ user, onSaved, onClose }) {
  const isNew = !user;
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'user',
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
      if (!payload.password) delete payload.password; // en edición: vacía = no cambiar
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
    <Modal title={isNew ? 'Nueva cuenta' : `Editar a ${user.name}`} onClose={onClose} maxWidth="max-w-md">
      {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre">
          <input className="field" value={form.name} onChange={set('name')} required placeholder="Nombre y apellido" />
        </Field>
        <Field label="Email">
          <input className="field" type="email" value={form.email} onChange={set('email')} required placeholder="correo@empresa.com" />
        </Field>
        <Field label={isNew ? 'Contraseña' : 'Nueva contraseña'}
          hint={isNew ? 'Mínimo 8 caracteres' : 'Déjala vacía para no cambiarla'}>
          <input className="field" type="password" value={form.password} onChange={set('password')}
            required={isNew} minLength={8} autoComplete="new-password" placeholder="••••••••" />
        </Field>
        <Field label="Rol">
          <select className="field" value={form.role} onChange={set('role')}>
            <option value="user">Usuario</option>
            <option value="superadmin">Super admin</option>
          </select>
        </Field>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={form.mfaEnforced} onChange={set('mfaEnforced')} className="mt-0.5 accent-current" />
          <span className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">Exigir MFA</span>
            <br />
            Deberá configurar verificación en dos pasos en su próximo inicio de sesión.
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="soft" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : isNew ? 'Crear cuenta' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StatusBadge({ active }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
      active ? 'bg-sea-soft text-sea' : 'bg-rust-soft text-rust'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-sea' : 'bg-rust'}`} />
      {active ? 'Activa' : 'Desactivada'}
    </span>
  );
}

export default function Admin() {
  const { user: me } = useAuthStore();
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [deleting, setDeleting] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/users')
      .then(({ data }) => setUsers(data))
      .catch(() => setError('No se pudo cargar la lista de usuarios'));
  }, []);

  // El guard de ruta solo valida sesión; el rol llega async vía /auth/me
  if (me && me.role !== 'superadmin') return <Navigate to="/" replace />;

  const replaceUser = (u) => setUsers((list) => list.map((x) => (x.id === u.id ? u : x)));

  const patch = async (u, data) => {
    setError('');
    try {
      const { data: updated } = await api.patch(`/admin/users/${u.id}`, data);
      replaceUser(updated);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo actualizar');
    }
  };

  const resetMfa = async (u) => {
    setError('');
    try {
      const { data } = await api.post(`/admin/users/${u.id}/mfa/reset`);
      replaceUser(data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo resetear el MFA');
    } finally {
      setResetting(null);
    }
  };

  const remove = async (u) => {
    setError('');
    try {
      await api.delete(`/admin/users/${u.id}`);
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo eliminar');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl text-ink flex items-center gap-2">
              <Icon name="shield" size={22} className="text-lumen-deep" /> Usuarios
            </h1>
            <p className="text-sm text-ink-faint mt-1">
              Crea cuentas, otorga accesos, gestiona roles y verificación en dos pasos.
            </p>
          </div>
          <Button onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} /> Nueva cuenta
          </Button>
        </div>

        {error && <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>}

        {!users ? (
          <SkeletonCards count={3} height="h-16" />
        ) : users.length === 0 ? (
          <EmptyState icon="users" title="Sin usuarios" hint="Crea la primera cuenta del equipo." />
        ) : (
          <div className="bg-surface rounded-2xl border border-line-soft shadow-card overflow-x-auto animate-rise">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint border-b border-line-soft">
                  <th className="px-4 py-3 font-semibold">Usuario</th>
                  <th className="px-4 py-3 font-semibold">Rol</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">MFA</th>
                  <th className="px-4 py-3 font-semibold">Contenido</th>
                  <th className="px-4 py-3 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-line-soft last:border-0 hover:bg-paper-deep/40 transition">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">
                        {u.name}
                        {u.id === me?.id && <span className="text-xs text-ink-faint font-normal"> (tú)</span>}
                      </p>
                      <p className="text-xs text-ink-faint font-mono">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={u.role === 'superadmin' ? 'text-lumen-deep font-semibold' : 'text-ink-soft'}>
                        {ROLE_LABEL[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge active={u.isActive} /></td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-ink-soft">
                        {u.mfaEnabled ? '✓ Activo' : u.mfaEnforced ? 'Pendiente' : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-faint font-mono">
                      {u._count.reports} rep · {u._count.datasets} ds
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" title="Editar" onClick={() => setEditing(u)}>
                          <Icon name="pencil" size={14} />
                        </Button>
                        {u.id !== me?.id && (
                          <>
                            <Button variant="ghost" size="sm"
                              title={u.isActive ? 'Desactivar acceso' : 'Activar acceso'}
                              onClick={() => patch(u, { isActive: !u.isActive })}>
                              <Icon name={u.isActive ? 'lock' : 'check'} size={14} />
                            </Button>
                            {u.mfaEnabled && (
                              <Button variant="ghost" size="sm" title="Resetear MFA"
                                onClick={() => setResetting(u)}>
                                <Icon name="refresh" size={14} />
                              </Button>
                            )}
                            <Button variant="danger" size="sm" title="Eliminar cuenta"
                              onClick={() => setDeleting(u)}>
                              <Icon name="trash" size={14} />
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
      </main>

      {editing && (
        <UserFormModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            if (editing === 'new') setUsers((list) => [...list, u]);
            else replaceUser(u);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Eliminar cuenta"
          message={`Se eliminará la cuenta de ${deleting.name} junto con sus ${deleting._count.reports} reportes y ${deleting._count.datasets} datasets. Esta acción no se puede deshacer.`}
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
      {resetting && (
        <ConfirmModal
          title="Resetear MFA"
          message={`${resetting.name} volverá a entrar solo con contraseña${resetting.mfaEnforced ? ' y deberá configurar MFA de nuevo en su próximo login' : ''}.`}
          confirmLabel="Resetear"
          onConfirm={() => resetMfa(resetting)}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}
