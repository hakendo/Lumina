import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Wordmark, Button } from '../components/ui';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email, password, name);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la cuenta');
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
            Empieza a crear reportes hoy.
          </p>
        </div>

        <div className="bg-surface rounded-2xl shadow-card border border-line-soft p-7">
          {error && (
            <p className="text-rust text-sm mb-4 bg-rust-soft px-3 py-2.5 rounded-lg">{error}</p>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-soft mb-1">Nombre</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                required autoComplete="name" className="field" placeholder="¿Cómo te llamas?" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-soft mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" className="field" placeholder="tu@correo.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-soft mb-1">Contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={6} autoComplete="new-password" className="field"
                placeholder="Mínimo 6 caracteres" />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creando…' : 'Crear cuenta'}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-ink-faint mt-5">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-lumen-deep font-medium hover:underline">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}
