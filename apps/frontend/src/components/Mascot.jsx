import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Icon } from './ui';

/* ── Mascotas de Lúmina ───────────────────────────────────────────────────
   Ayudante flotante: saluda al entrar y ofrece pistas según la página.
   Cada usuario elige su mascota (se guarda en localStorage por user.id),
   puede ocultarla y volver a mostrarla desde el botón de la esquina.     */

const HIDDEN_KEY = 'lumina:mascot-hidden';
const choiceKey = (userId) => `lumina:mascot:${userId ?? 'anon'}`;

// Rutas donde la mascota no debe aparecer: públicas y la vista que captura
// Puppeteer para el export PDF (saldría impresa en el documento).
const EXCLUDED = [/^\/login/, /^\/public\//, /^\/report\/[^/]+\/view/];

const TIPS = [
  { match: /^\/datasets/, tip: 'Sube un CSV o Excel, o conecta una API o base de datos. Después de sincronizar, tus reportes se actualizan solos.' },
  { match: /^\/explore/, tip: 'Explora tus datos antes de armar un reporte: filtra, ordena y descubre qué columnas valen la pena graficar.' },
  { match: /^\/report\//, tip: 'Arrastra los bordes de los widgets para acomodarlos en el lienzo. Con Ctrl+S guardas los cambios al instante.' },
  { match: /^\/$/, tip: 'Aquí viven tus reportes. Crea uno nuevo, márcalo con la estrella para tenerlo a mano, o compártelo con un enlace público.' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/* ── Los siete dibujos, a mano con la paleta de la mesa de luz ──────────
   Tinta para el pelaje, papel para la cara, ámbar/mar/óxido de acento.  */

function MonoSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="56" cy="46" r="12" fill="var(--color-lumen-glow)" opacity="0.25" />
      <path d="M16 52c-7 1-11-5-7-9" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="33" cy="50" rx="14" ry="12" fill="var(--color-ink)" />
      <ellipse cx="33" cy="52" rx="8" ry="7" fill="var(--color-lumen-soft)" />
      <path d="M44 48c4 1 8 0 10-3" fill="none" stroke="var(--color-ink)" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="52.5" y="42" width="8" height="9" rx="2" fill="var(--color-lumen)" />
      <circle cx="56.5" cy="46.5" r="2.2" fill="#fff3d6" />
      <path d="M56.5 40v-3" stroke="var(--color-lumen-deep)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="24" r="6.5" fill="var(--color-ink)" />
      <circle cx="48" cy="24" r="6.5" fill="var(--color-ink)" />
      <circle cx="18" cy="24" r="3" fill="var(--color-lumen-soft)" />
      <circle cx="48" cy="24" r="3" fill="var(--color-lumen-soft)" />
      <circle cx="33" cy="26" r="14" fill="var(--color-ink)" />
      <path d="M22.5 28a10.5 8.5 0 1 0 21 0 8 7 0 0 0-10.5-6.5A8 7 0 0 0 22.5 28z" fill="var(--color-lumen-soft)" />
      <circle cx="28.5" cy="26.5" r="1.8" fill="var(--color-ink)" />
      <circle cx="37.5" cy="26.5" r="1.8" fill="var(--color-ink)" />
      <path d="M29.5 31.5q3.5 3 7 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AranaSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      {/* hilo */}
      <path d="M36 2v16" stroke="var(--color-ink-faint)" strokeWidth="1.5" strokeDasharray="3 3" />
      {/* patas */}
      <path d="M25 36c-9-1-14 3-16 8" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M24 42c-8 1-12 6-13 11" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M27 48c-6 3-8 8-8 13" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M47 36c9-1 14 3 16 8" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M48 42c8 1 12 6 13 11" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M45 48c6 3 8 8 8 13" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      {/* cuerpo */}
      <circle cx="36" cy="42" r="15" fill="var(--color-ink)" />
      {/* lunar ámbar */}
      <circle cx="36" cy="52" r="3.5" fill="var(--color-lumen-glow)" opacity="0.85" />
      {/* cara */}
      <ellipse cx="36" cy="37" rx="10" ry="8" fill="var(--color-lumen-soft)" />
      <circle cx="31.5" cy="36" r="1.8" fill="var(--color-ink)" />
      <circle cx="40.5" cy="36" r="1.8" fill="var(--color-ink)" />
      <path d="M32.5 41q3.5 3 7 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GatoSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      {/* cola */}
      <path d="M50 58c8 0 12-6 8-11" fill="none" stroke="var(--color-ink)" strokeWidth="3.5" strokeLinecap="round" />
      {/* cuerpo */}
      <ellipse cx="36" cy="54" rx="14" ry="10" fill="var(--color-ink)" />
      <ellipse cx="36" cy="56" rx="8" ry="6" fill="var(--color-lumen-soft)" />
      {/* orejas */}
      <path d="M22 22 24 9l9 8z" fill="var(--color-ink)" />
      <path d="M50 22 48 9l-9 8z" fill="var(--color-ink)" />
      <path d="M24.5 19l1.2-6 4.5 4z" fill="var(--color-lumen-soft)" />
      <path d="M47.5 19l-1.2-6-4.5 4z" fill="var(--color-lumen-soft)" />
      {/* cabeza */}
      <circle cx="36" cy="28" r="14" fill="var(--color-ink)" />
      <ellipse cx="36" cy="31" rx="10.5" ry="8.5" fill="var(--color-lumen-soft)" />
      {/* ojos y hocico */}
      <circle cx="31" cy="29" r="1.8" fill="var(--color-ink)" />
      <circle cx="41" cy="29" r="1.8" fill="var(--color-ink)" />
      <path d="M34.8 33h2.4l-1.2 1.6z" fill="var(--color-lumen-deep)" />
      <path d="M36 34.6v1.8M36 36.4q-2 2-4 .6M36 36.4q2 2 4 .6" fill="none" stroke="var(--color-ink)" strokeWidth="1.4" strokeLinecap="round" />
      {/* bigotes */}
      <path d="M24 31h-7M24 34l-6 2M48 31h7M48 34l6 2" stroke="var(--color-ink-soft)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PerroSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      {/* cola */}
      <path d="M50 56c7-1 10-7 7-12" fill="none" stroke="var(--color-ink)" strokeWidth="3.5" strokeLinecap="round" />
      {/* cuerpo */}
      <ellipse cx="36" cy="54" rx="14" ry="10" fill="var(--color-ink)" />
      <ellipse cx="36" cy="56" rx="8" ry="6" fill="var(--color-lumen-soft)" />
      {/* orejas caídas */}
      <ellipse cx="21" cy="27" rx="6" ry="11" fill="var(--color-ink)" transform="rotate(14 21 27)" />
      <ellipse cx="51" cy="27" rx="6" ry="11" fill="var(--color-ink)" transform="rotate(-14 51 27)" />
      {/* cabeza */}
      <circle cx="36" cy="27" r="14" fill="var(--color-ink)" />
      <ellipse cx="36" cy="31" rx="10.5" ry="9" fill="var(--color-lumen-soft)" />
      {/* ojos, nariz, lengua */}
      <circle cx="31" cy="28" r="1.8" fill="var(--color-ink)" />
      <circle cx="41" cy="28" r="1.8" fill="var(--color-ink)" />
      <ellipse cx="36" cy="33" rx="2.4" ry="1.8" fill="var(--color-ink)" />
      <path d="M36 34.8v2" stroke="var(--color-ink)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M33 37.5q3 2.5 6 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M36.5 38c0 3 1 4.5 3 4.5 1.6 0 2-1.5 1.4-3" fill="var(--color-rust)" opacity="0.85" />
      {/* mancha ámbar */}
      <circle cx="44" cy="22" r="3.5" fill="var(--color-lumen-glow)" opacity="0.55" />
    </svg>
  );
}

function LagartijaSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      {/* cola enroscada */}
      <path d="M22 50c-9 2-15-3-13-10 1.5-5 7-6 9-2" fill="none" stroke="var(--color-sea)" strokeWidth="4.5" strokeLinecap="round" />
      {/* patas */}
      <path d="M30 52l-4 8M40 52l-3 8M46 44l6 6M34 40l-7 5" fill="none" stroke="var(--color-sea)" strokeWidth="3" strokeLinecap="round" />
      {/* cuerpo */}
      <ellipse cx="38" cy="45" rx="15" ry="9.5" fill="var(--color-sea)" transform="rotate(-18 38 45)" />
      <ellipse cx="37" cy="48" rx="8" ry="4.5" fill="var(--color-sea-soft)" transform="rotate(-18 37 48)" />
      {/* lomo con escamas ámbar */}
      <circle cx="32" cy="42" r="1.6" fill="var(--color-lumen-glow)" />
      <circle cx="38" cy="40" r="1.6" fill="var(--color-lumen-glow)" />
      <circle cx="44" cy="39" r="1.6" fill="var(--color-lumen-glow)" />
      {/* cabeza */}
      <circle cx="52" cy="32" r="9.5" fill="var(--color-sea)" />
      <ellipse cx="53" cy="35" rx="6.5" ry="5" fill="var(--color-sea-soft)" />
      <circle cx="50" cy="31" r="1.8" fill="var(--color-ink)" />
      <circle cx="57" cy="31" r="1.8" fill="var(--color-ink)" />
      <path d="M51 36q2.5 2 5 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TortugaSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      {/* patas y cola */}
      <path d="M18 52l-5 7M44 54l3 8M14 44l-8 1" fill="none" stroke="var(--color-sea)" strokeWidth="4" strokeLinecap="round" />
      {/* cabeza */}
      <circle cx="55" cy="42" r="8.5" fill="var(--color-sea)" />
      <ellipse cx="56" cy="45" rx="5.5" ry="4" fill="var(--color-sea-soft)" />
      <circle cx="53" cy="41" r="1.7" fill="var(--color-ink)" />
      <circle cx="59" cy="41" r="1.7" fill="var(--color-ink)" />
      <path d="M54 45.5q2 1.8 4.5 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.5" strokeLinecap="round" />
      {/* caparazón ámbar — la lúmina que carga encima */}
      <path d="M10 50a22 19 0 0 1 44 0z" fill="var(--color-lumen)" />
      <path d="M14.5 50a17.5 15 0 0 1 35 0z" fill="var(--color-lumen-glow)" opacity="0.45" />
      <path d="M32 31v19M20 38l6 12M44 38l-6 12M13 46h38" fill="none" stroke="var(--color-lumen-deep)" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      {/* borde del caparazón */}
      <path d="M9 50h46" stroke="var(--color-lumen-deep)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function PulpoSvg({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      {/* tentáculos */}
      <path d="M22 44c-2 8-8 10-13 8" fill="none" stroke="var(--color-rust)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M29 48c-1 8-5 12-10 13" fill="none" stroke="var(--color-rust)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M37 49c1 7 4 11 9 12" fill="none" stroke="var(--color-rust)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M45 46c3 7 9 9 14 7" fill="none" stroke="var(--color-rust)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M48 41c5 4 10 4 13 1" fill="none" stroke="var(--color-rust)" strokeWidth="4" strokeLinecap="round" />
      {/* cabeza */}
      <circle cx="34" cy="30" r="16" fill="var(--color-rust)" />
      <ellipse cx="34" cy="36" rx="11" ry="7.5" fill="var(--color-rust-soft)" />
      {/* ojos y sonrisa */}
      <circle cx="28.5" cy="33" r="2" fill="var(--color-ink)" />
      <circle cx="39.5" cy="33" r="2" fill="var(--color-ink)" />
      <path d="M30.5 39q3.5 3 7 0" fill="none" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" />
      {/* brillo ámbar */}
      <circle cx="42" cy="21" r="3.5" fill="var(--color-lumen-glow)" opacity="0.5" />
    </svg>
  );
}

const MASCOTS = {
  mono: { label: 'Monito', name: 'Lumi', emoji: '🐒', Svg: MonoSvg },
  arana: { label: 'Araña', name: 'Telma', emoji: '🕷️', Svg: AranaSvg },
  gato: { label: 'Gato', name: 'Brasa', emoji: '🐈', Svg: GatoSvg },
  perro: { label: 'Perro', name: 'Faro', emoji: '🐕', Svg: PerroSvg },
  lagartija: { label: 'Lagartija', name: 'Chispa', emoji: '🦎', Svg: LagartijaSvg },
  tortuga: { label: 'Tortuga', name: 'Ámbar', emoji: '🐢', Svg: TortugaSvg },
  pulpo: { label: 'Pulpo', name: 'Tinta', emoji: '🐙', Svg: PulpoSvg },
};

export default function Mascot() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDDEN_KEY) === '1');
  // La burbuja recuerda en qué ruta se cerró: al navegar a otra sección
  // se reabre sola con el tip correspondiente, sin necesidad de un effect.
  const [closedOn, setClosedOn] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // La elección vive en localStorage por usuario; `picked` guarda también
  // la clave para no arrastrar la elección de otro usuario tras re-login.
  const [picked, setPicked] = useState(null);

  if (!token || EXCLUDED.some((re) => re.test(pathname))) return null;

  const storageKey = choiceKey(user?.id);
  const kind = (picked?.key === storageKey ? picked.kind : null) ?? localStorage.getItem(storageKey);
  const mascot = MASCOTS[kind] ?? MASCOTS.mono;
  const bubbleOpen = closedOn !== pathname;

  const pick = (k) => {
    localStorage.setItem(storageKey, k);
    setPicked({ key: storageKey, kind: k });
  };
  const hide = () => {
    localStorage.setItem(HIDDEN_KEY, '1');
    setHidden(true);
    setPickerOpen(false);
  };
  const show = () => {
    localStorage.removeItem(HIDDEN_KEY);
    setHidden(false);
    setClosedOn(null);
  };

  if (hidden) {
    return (
      <button
        onClick={show}
        title={`Mostrar a ${mascot.name}`}
        aria-label={`Mostrar a ${mascot.name}, el ayudante`}
        className="fixed bottom-4 right-4 z-40 w-9 h-9 rounded-full bg-surface border border-line shadow-card grid place-items-center text-ink-faint hover:text-lumen-deep hover:border-lumen-line transition cursor-pointer"
      >
        <mascot.Svg size={26} />
      </button>
    );
  }

  const tip = TIPS.find((t) => t.match.test(pathname))?.tip;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 pointer-events-none">
      {pickerOpen && (
        <div className="pointer-events-auto relative w-65 bg-surface border border-line rounded-2xl shadow-lift p-3 animate-rise">
          <button
            onClick={() => setPickerOpen(false)}
            aria-label="Cerrar selector de mascota"
            className="absolute top-2 right-2 text-ink-faint hover:text-ink transition cursor-pointer"
          >
            <Icon name="x" size={13} />
          </button>
          <p className="text-xs font-semibold text-ink-soft mb-2">Elige tu mascota</p>
          <div className="grid grid-cols-4 gap-1.5">
            {Object.entries(MASCOTS).map(([key, m]) => (
              <button
                key={key}
                onClick={() => pick(key)}
                title={`${m.label} — ${m.name}`}
                className={`flex flex-col items-center gap-0.5 rounded-xl p-1.5 transition cursor-pointer ${
                  key === (MASCOTS[kind] ? kind : 'mono')
                    ? 'bg-lumen-soft ring-1 ring-lumen-line'
                    : 'hover:bg-paper-deep'
                }`}
              >
                <m.Svg size={34} />
                <span className="text-[10px] text-ink-soft leading-none">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {bubbleOpen && (
        <div className="pointer-events-auto relative max-w-65 bg-surface border border-line rounded-2xl rounded-br-sm shadow-lift px-4 py-3 animate-rise">
          <button
            onClick={() => setClosedOn(pathname)}
            aria-label="Cerrar mensaje"
            className="absolute top-2 right-2 text-ink-faint hover:text-ink transition cursor-pointer"
          >
            <Icon name="x" size={13} />
          </button>
          <p className="font-display text-sm text-ink pr-4">
            ¡{greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! Soy {mascot.name} {mascot.emoji}
          </p>
          {tip && <p className="text-xs text-ink-soft mt-1.5 leading-relaxed">{tip}</p>}
          <div className="flex items-center gap-3 mt-2.5">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="text-[11px] text-ink-faint hover:text-lumen-deep transition cursor-pointer underline underline-offset-2"
            >
              Cambiar mascota
            </button>
            <button
              onClick={hide}
              className="text-[11px] text-ink-faint hover:text-rust transition cursor-pointer underline underline-offset-2"
            >
              Ocultar a {mascot.name}
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setClosedOn(bubbleOpen ? pathname : null)}
        title={bubbleOpen ? 'Guardar mensaje' : '¿Necesitas ayuda?'}
        aria-label={bubbleOpen ? `Cerrar mensaje de ${mascot.name}` : `Pedir ayuda a ${mascot.name}`}
        className="pointer-events-auto animate-bob drop-shadow-md hover:scale-105 transition-transform cursor-pointer"
      >
        <mascot.Svg />
      </button>
    </div>
  );
}
