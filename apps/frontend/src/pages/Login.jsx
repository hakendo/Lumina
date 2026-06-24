import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Wordmark, Button } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState(null); // { qr, secret } durante el setup obligatorio
  const [step, setStep] = useState('credentials'); // credentials | code | setup
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, verifyMfa, setupMfa, enableMfa, cancelMfa } = useAuthStore();
  const navigate = useNavigate();

  const submitCredentials = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.mfa) return navigate('/');
      if (result.setup) {
        const data = await setupMfa();
        setQr(data);
        setStep('setup');
      } else {
        setStep('code');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (step === 'setup') await enableMfa(code);
      else await verifyMfa(code);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Código incorrecto');
    } finally {
      setLoading(false);
    }
  };

  const back = () => {
    cancelMfa();
    setStep('credentials');
    setCode('');
    setQr(null);
    setError('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center paper-bg px-4">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 text-center">
          <Wordmark size="text-3xl" className="justify-center" />
          <p className="text-ink-faint text-sm mt-3 font-display italic">
            Pon tus datos bajo la luz.
          </p>
        </div>

        <div className="bg-surface rounded-2xl shadow-card border border-line-soft p-7">
          {error && (
            <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>
          )}

          {step === 'credentials' && (
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required autoComplete="email" className="field" placeholder="tu@correo.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">Contraseña</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoComplete="current-password" className="field" placeholder="••••••••" />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Iniciando…' : 'Iniciar sesión'}
              </Button>
            </form>
          )}

          {(step === 'code' || step === 'setup') && (
            <form onSubmit={submitCode} className="space-y-4">
              {step === 'setup' ? (
                <>
                  <p className="text-sm text-ink-soft">
                    Tu cuenta requiere verificación en dos pasos. Escanea el código con tu app
                    de autenticación (Google Authenticator, Authy…) e ingresa el código de 6 dígitos.
                  </p>
                  {qr && (
                    <div className="text-center">
                      <img src={qr.qr} alt="Código QR para MFA" className="mx-auto w-44 h-44 rounded-lg border border-line-soft" />
                      <p className="text-xs text-ink-faint mt-2">
                        ¿No puedes escanear? Clave manual:{' '}
                        <span className="font-mono text-ink-soft break-all">{qr.secret}</span>
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-soft">
                  Ingresa el código de 6 dígitos de tu app de autenticación.
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">Código</label>
                <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required autoFocus autoComplete="one-time-code"
                  className="field field-mono text-center tracking-[0.5em]" placeholder="000000" />
              </div>
              <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                {loading ? 'Verificando…' : step === 'setup' ? 'Activar y entrar' : 'Verificar'}
              </Button>
              <button type="button" onClick={back}
                className="w-full text-sm text-ink-faint hover:text-ink transition cursor-pointer">
                Volver
              </button>
            </form>
          )}
        </div>

        {step === 'credentials' && (
          <p className="text-center text-sm text-ink-faint mt-5">
            ¿No tienes cuenta? Pídele acceso a tu administrador.
          </p>
        )}
      </div>
    </div>
  );
}
