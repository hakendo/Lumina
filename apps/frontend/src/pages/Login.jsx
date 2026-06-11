import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Wordmark, Button } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
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

          <form onSubmit={submit} className="space-y-4">
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
        </div>

        <p className="text-center text-sm text-ink-faint mt-5">
          ¿No tienes cuenta?{' '}
          <Link to="/register" className="text-lumen-deep font-medium hover:underline">Regístrate</Link>
        </p>
      </div>
    </div>
  );
}
