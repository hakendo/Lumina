import { useState } from 'react';
import { AppHeader, Button, Icon, Modal } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';

// ── Cambiar contraseña ─────────────────────────────────────────────

function PasswordSection() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'ok' | 'err', text }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setMsg({ type: 'err', text: 'Las contraseñas no coinciden' });
      return;
    }
    if (form.newPassword.length < 8) {
      setMsg({ type: 'err', text: 'Mínimo 8 caracteres' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await api.patch('/auth/me/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setMsg({ type: 'ok', text: 'Contraseña actualizada.' });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al cambiar contraseña' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface rounded-2xl border border-line-soft p-6">
      <h2 className="font-display text-base text-ink mb-4 flex items-center gap-2">
        <Icon name="lock" size={16} className="text-ink-faint" /> Contraseña
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3 max-w-sm">
        <div>
          <label className="text-xs font-semibold text-ink-soft uppercase tracking-widest block mb-1">
            Contraseña actual
          </label>
          <input type="password" value={form.currentPassword} onChange={set('currentPassword')}
            className="field field-sm" autoComplete="current-password" required />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-soft uppercase tracking-widest block mb-1">
            Nueva contraseña
          </label>
          <input type="password" value={form.newPassword} onChange={set('newPassword')}
            className="field field-sm" autoComplete="new-password" minLength={8} required />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-soft uppercase tracking-widest block mb-1">
            Confirmar contraseña
          </label>
          <input type="password" value={form.confirm} onChange={set('confirm')}
            className="field field-sm" autoComplete="new-password" required />
        </div>
        {msg && (
          <p className={`text-xs px-3 py-2 rounded-lg ${
            msg.type === 'ok' ? 'text-sea bg-sea/10' : 'text-rust bg-rust-soft'
          }`}>
            {msg.type === 'ok' ? <Icon name="check" size={12} className="inline mr-1" /> : null}
            {msg.text}
          </p>
        )}
        <div>
          <Button type="submit" size="sm" disabled={busy || !form.currentPassword || !form.newPassword}>
            {busy ? 'Guardando…' : 'Cambiar contraseña'}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ── MFA setup modal ────────────────────────────────────────────────

function MfaSetupModal({ onDone, onClose }) {
  const { setupMfa, enableMfa } = useAuthStore();
  const [step, setStep] = useState('loading'); // loading | qr | confirm
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Generate secret + QR on mount
  useState(() => {
    setupMfa()
      .then((data) => { setQr(data.qr); setStep('qr'); })
      .catch(() => { setErr('No se pudo generar el código QR'); setStep('qr'); });
  });

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await enableMfa(code);
      onDone();
    } catch (error) {
      setErr(error.response?.data?.error ?? 'Código incorrecto');
      setBusy(false);
    }
  };

  return (
    <Modal title="Activar autenticación de dos factores" onClose={onClose}>
      {step === 'loading' && <div className="skeleton h-48" />}
      {step === 'qr' && (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">
            Escanea el código QR con tu app de autenticación (Google Authenticator, Authy, etc.):
          </p>
          {qr ? (
            <img src={qr} alt="QR MFA" className="w-44 h-44 mx-auto rounded-xl border border-line-soft" />
          ) : (
            <p className="text-xs text-rust">{err}</p>
          )}
          {qr && (
            <>
              <div>
                <label className="text-xs font-semibold text-ink-soft uppercase tracking-widest block mb-1">
                  Código de verificación
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="field field-sm field-mono w-32"
                  autoFocus
                />
              </div>
              {err && <p className="text-xs text-rust">{err}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancelar</Button>
                <Button size="sm" type="submit" disabled={busy || code.length !== 6}>
                  {busy ? 'Verificando…' : 'Activar MFA'}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </Modal>
  );
}

// ── MFA disable modal ──────────────────────────────────────────────

function MfaDisableModal({ onDone, onClose }) {
  const { disableMfa } = useAuthStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await disableMfa(code);
      onDone();
    } catch (error) {
      setErr(error.response?.data?.error ?? 'Código incorrecto');
      setBusy(false);
    }
  };

  return (
    <Modal title="Desactivar autenticación de dos factores" onClose={onClose}>
      <p className="text-sm text-ink-soft mb-4">
        Ingresa el código actual de tu app de autenticación para confirmar.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="field field-sm field-mono w-32"
          autoFocus
        />
        {err && <p className="text-xs text-rust">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancelar</Button>
          <Button variant="dangerSolid" size="sm" type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Desactivando…' : 'Desactivar MFA'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Sección MFA ────────────────────────────────────────────────────

function MfaSection() {
  const { user } = useAuthStore();
  const [showSetup, setShowSetup] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [done, setDone] = useState(null); // 'enabled' | 'disabled'

  const mfaEnabled = done === 'enabled' ? true : done === 'disabled' ? false : user?.mfaEnabled;

  return (
    <section className="bg-surface rounded-2xl border border-line-soft p-6">
      <h2 className="font-display text-base text-ink mb-4 flex items-center gap-2">
        <Icon name="shield" size={16} className="text-ink-faint" /> Autenticación de dos factores (MFA)
      </h2>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          {mfaEnabled ? (
            <p className="text-sm text-sea flex items-center gap-1.5">
              <Icon name="check" size={14} /> MFA activo — tu cuenta tiene protección extra.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">
              MFA desactivado. Actívalo para mayor seguridad.
            </p>
          )}
          {user?.mfaEnforced && !mfaEnabled && (
            <p className="text-xs text-rust mt-1">
              <Icon name="lock" size={12} className="inline mr-1" />
              Tu organización exige MFA. Debes activarlo.
            </p>
          )}
        </div>
        {mfaEnabled ? (
          <Button
            variant="soft"
            size="sm"
            onClick={() => setShowDisable(true)}
            disabled={user?.mfaEnforced}
            title={user?.mfaEnforced ? 'El administrador exige MFA en esta cuenta' : undefined}
          >
            <Icon name="shield-off" size={13} /> Desactivar
          </Button>
        ) : (
          <Button size="sm" onClick={() => setShowSetup(true)}>
            <Icon name="shield" size={13} /> Activar MFA
          </Button>
        )}
      </div>

      {showSetup && (
        <MfaSetupModal
          onDone={() => { setShowSetup(false); setDone('enabled'); }}
          onClose={() => setShowSetup(false)}
        />
      )}
      {showDisable && (
        <MfaDisableModal
          onDone={() => { setShowDisable(false); setDone('disabled'); }}
          onClose={() => setShowDisable(false)}
        />
      )}
    </section>
  );
}

// ── Página principal ───────────────────────────────────────────────

export default function Profile() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen paper-bg">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-2xl text-ink">Mi perfil</h1>
          <p className="text-sm text-ink-faint mt-1">{user?.email}</p>
        </div>

        <div className="flex flex-col gap-5">
          <PasswordSection />
          <MfaSection />
        </div>
      </main>
    </div>
  );
}
