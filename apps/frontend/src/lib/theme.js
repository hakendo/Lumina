// ── Tema visual de la org ────────────────────────────────────────────────
// Aplica Organization.themeConfig (traído en /auth/me como `orgTheme`) como
// CSS custom properties sobre :root. Como los tokens de src/index.css están
// definidos con Tailwind v4 `@theme`, cada utilidad (bg-lumen, text-lumen-deep,
// font-display…) ya referencia `var(--color-lumen)` / `var(--font-display)`
// en vez de un valor fijo — sobreescribir la variable en runtime basta para
// re-pintar toda la app, sin tocar ninguna className.
//
// Claves soportadas en themeConfig (todas opcionales):
//   lumen, lumenDeep, lumenGlow, sea, rust   — colores hex (#rrggbb)
//   fontDisplay, fontSans                    — nombre de familia tipográfica
//
// Las fuentes deben estar precargadas en index.html (ver comentario ahí);
// esto evita tener que inyectar <link> dinámicamente y mantiene una lista
// cerrada de opciones válidas (también validada en el backend).

const COLOR_VARS = {
  lumen: '--color-lumen',
  lumenDeep: '--color-lumen-deep',
  lumenGlow: '--color-lumen-glow',
  sea: '--color-sea',
  rust: '--color-rust',
};

const FONT_STACKS = {
  display: {
    Barlow: '"Barlow", system-ui, sans-serif',
    Fraunces: '"Fraunces", Georgia, "Times New Roman", serif',
    'Nunito Sans': '"Nunito Sans", system-ui, sans-serif',
  },
  sans: {
    'Nunito Sans': '"Nunito Sans", system-ui, sans-serif',
    'Hanken Grotesk': '"Hanken Grotesk", system-ui, sans-serif',
    Barlow: '"Barlow", system-ui, sans-serif',
  },
};

// Opciones ofrecidas en el picker de Mi Org → Apariencia (deben coincidir
// con las listas blancas THEME_FONT_*_OPTIONS de apps/backend/src/routes/org.js).
export const FONT_DISPLAY_OPTIONS = Object.keys(FONT_STACKS.display);
export const FONT_SANS_OPTIONS = Object.keys(FONT_STACKS.sans);

export function applyOrgTheme(themeConfig) {
  const root = document.documentElement;
  const theme = themeConfig ?? {};

  for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
    if (theme[key]) root.style.setProperty(cssVar, theme[key]);
    else root.style.removeProperty(cssVar);
  }

  if (theme.fontDisplay && FONT_STACKS.display[theme.fontDisplay]) {
    root.style.setProperty('--font-display', FONT_STACKS.display[theme.fontDisplay]);
  } else {
    root.style.removeProperty('--font-display');
  }

  if (theme.fontSans && FONT_STACKS.sans[theme.fontSans]) {
    root.style.setProperty('--font-sans', FONT_STACKS.sans[theme.fontSans]);
  } else {
    root.style.removeProperty('--font-sans');
  }
}
