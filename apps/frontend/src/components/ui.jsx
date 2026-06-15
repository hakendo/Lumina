import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/* ── Iconos (trazos estilo lucide, heredan currentColor) ─────────────── */

const PATHS = {
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  hash: <><path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="M16 3l-2 18" /></>,
  table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" /><path d="M3 9h18" /><path d="M3 15h18" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  sliders: <><path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" /><path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></>,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>,
  shield: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  'shield-off': <><path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18" /><path d="M4.73 4.73 4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38" /><line x1="2" y1="2" x2="22" y2="22" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  building: <><rect x="3" y="9" width="18" height="12" rx="1" /><path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4" /><path d="M9 21V12" /><path d="M15 21V12" /></>,
  layers: <><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>,
  userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></>,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
};

export function Icon({ name, size = 16, className = '', filled = false, strokeWidth = 2 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`} aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ── Marca ────────────────────────────────────────────────────────────── */

export function Wordmark({ className = '', size = 'text-xl' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid place-items-center w-7 h-7 rounded-full bg-ink text-lumen-glow">
        <Icon name="sun" size={15} strokeWidth={2.2} />
      </span>
      <span className={`font-display italic font-semibold tracking-tight text-ink ${size}`}>
        Lúmina
      </span>
    </span>
  );
}

/* ── Header de la app (Dashboard / Datasets / Explorar) ──────────────── */

const NAV = [
  { to: '/', label: 'Reportes' },
  { to: '/datasets', label: 'Datasets' },
  { to: '/explore', label: 'Explorar' },
];

export function AppHeader() {
  const { user, logout } = useAuthStore();
  const nav = user?.role === 'superadmin' ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV;
  return (
    <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur border-b border-line">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-6">
        <Link to="/" className="shrink-0"><Wordmark size="text-lg" /></Link>
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {nav.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm transition ${
                  isActive
                    ? 'text-lumen-deep bg-lumen-soft font-semibold'
                    : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
                }`
              }>
              {label}
            </NavLink>
          ))}
        </nav>
        <span className="text-sm text-ink-faint hidden sm:block">{user?.name}</span>
        <button onClick={logout}
          className="text-sm text-ink-soft hover:text-rust transition cursor-pointer">
          Salir
        </button>
      </div>
    </header>
  );
}

/* ── Controles ────────────────────────────────────────────────────────── */

const BTN = {
  primary: 'bg-ink text-paper hover:bg-ink/85',
  accent: 'bg-lumen text-surface hover:bg-lumen-deep',
  ghost: 'bg-transparent text-ink-soft hover:bg-paper-deep hover:text-ink',
  soft: 'bg-paper-deep text-ink-soft hover:bg-line-soft hover:text-ink',
  danger: 'bg-transparent text-rust hover:bg-rust-soft',
  dangerSolid: 'bg-rust text-surface hover:opacity-85',
};

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${sizes[size]} ${BTN[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-soft mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-lumen-deep mt-1">{hint}</p>}
    </div>
  );
}

/* ── Estados ──────────────────────────────────────────────────────────── */

export function EmptyState({ icon = 'chart', title, hint, children }) {
  return (
    <div className="text-center py-16 animate-rise">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-lumen-soft text-lumen-deep grid place-items-center mb-4">
        <Icon name={icon} size={26} strokeWidth={1.6} />
      </div>
      <p className="font-display text-lg text-ink mb-1">{title}</p>
      {hint && <p className="text-sm text-ink-faint max-w-sm mx-auto">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function SkeletonCards({ count = 6, height = 'h-36' }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`skeleton ${height}`} style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

export function ConfirmModal({ title = '¿Estás seguro?', message, confirmLabel = 'Eliminar', onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} maxWidth="max-w-sm">
      <p className="text-sm text-ink-soft">{message}</p>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="soft" size="sm" onClick={onClose}>Cancelar</Button>
        <Button variant="dangerSolid" size="sm" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

// Esqueleto de un reporte (vista / builder) mientras carga
export function ReportSkeleton() {
  return (
    <div className="p-6 grid grid-cols-12 gap-4 max-w-5xl mx-auto w-full">
      <div className="skeleton col-span-12 md:col-span-8 h-72" />
      <div className="col-span-12 md:col-span-4 flex flex-col gap-4">
        <div className="skeleton h-24" style={{ animationDelay: '80ms' }} />
        <div className="skeleton h-44" style={{ animationDelay: '160ms' }} />
      </div>
      <div className="skeleton col-span-12 h-40" style={{ animationDelay: '240ms' }} />
    </div>
  );
}

export function Modal({ title, onClose, children, maxWidth = 'max-w-lg' }) {
  const mouseDownTarget = useRef(null);
  return createPortal(
    <div
      className="fixed inset-0 bg-ink/45 backdrop-blur-[2px] flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => { mouseDownTarget.current = e.target; }}
      onClick={(e) => { if (mouseDownTarget.current === e.currentTarget) onClose(); }}
    >
      <div
        className={`bg-surface rounded-2xl shadow-lift w-full ${maxWidth} max-h-[90vh] overflow-y-auto animate-rise`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-soft">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink transition cursor-pointer" aria-label="Cerrar">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
