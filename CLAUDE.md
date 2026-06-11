# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo contains two distinct things:

1. **Lúmina** (`apps/`) — the main project: a BI / reporting web app (npm workspaces monorepo).
2. **AntuNexus prototype** (`index.html` at the repo root) — an older, standalone static design-system showcase. Single file, React via CDN + Babel Standalone, no build step. `site.zip` is a backup snapshot of it. Do not confuse it with the Lúmina app.

## Lúmina — main app

### Running

```bash
npm install            # once, at repo root (workspaces)
npm run dev            # backend + frontend concurrently
npm run dev:backend    # Express API only
npm run dev:frontend   # Vite dev server only
```

There are no tests configured. Frontend lint: `npm --workspace=apps/frontend run lint`.

### Architecture

**Backend** (`apps/backend/`): Express + Prisma (SQLite). Structure:
- `src/routes/` — `auth.js` (JWT), `datasets.js` (CSV/Excel upload, API connectors, DB connectors), `reports.js` (CRUD, favorites, public share via slug, PDF export)
- `src/services/` — `dataParser.js`, `encryption.js` (AES-256-GCM for connector credentials), `pdfExport.js`
- `src/middleware/auth.js` — JWT verification
- `prisma/schema.prisma` — User, Dataset, DataRow, Report, Widget models

**Frontend** (`apps/frontend/`): React 19 + Vite + Tailwind CSS v4.
- `src/pages/` — Login, Register, Dashboard, Datasets, Explore, ReportBuilder, PublicReport
- `src/components/ui.jsx` — shared design-system primitives: `Icon` (inline SVG set), `Wordmark`, `AppHeader`, `Button`, `Field`, `EmptyState`, `SkeletonCards`, `Modal`. **Always use these instead of ad-hoc markup.**
- `src/components/Canvas/` — report builder internals (WidgetRenderer with per-dataset row cache, WidgetConfigPanel, FilterBar)
- `src/components/widgets/` — Chart (ECharts), KPI, Table, Pivot, Map (Leaflet)
- `src/store/` — Zustand stores (`authStore`, `reportStore` with `isDirty` tracking + `applyFilters` helper)
- `src/lib/api.js` — Axios instance; injects JWT, redirects to /login on 401

### Design system ("mesa de luz")

Tokens live in `src/index.css` under `@theme` (Tailwind v4 — no `tailwind.config.js`):

- **Colors:** `paper`/`paper-deep`/`surface` (warm backgrounds), `ink`/`ink-soft`/`ink-faint` (text), `line`/`line-soft` (borders), `lumen-*` (amber accent), `sea` (success/public), `rust` (danger). Use these token classes (`bg-paper`, `text-ink`, `border-line`…) — never raw slate/indigo palette classes.
- **Fonts:** `font-display` (Fraunces, headings/wordmark), `font-sans` (Hanken Grotesk, body), `font-mono` (Spline Sans Mono, data/numbers/technical details). Loaded via Google Fonts in `index.html`.
- **Utilities:** `.paper-bg` (page background with grain + glow), `.canvas-bg` (dotted builder canvas), `.field`/`.field-sm`/`.field-mono` (inputs), `.skeleton` (loading shimmer), `animate-rise` (entry animation).
- Chart palette for ECharts is mirrored in `src/components/widgets/ChartWidget.jsx` (`COLORS`).

### Conventions

- UI copy is in Spanish.
- Data caching: `WidgetRenderer` caches dataset rows in a module-level `CACHE`; call `invalidateDatasetCache(datasetId)` after any operation that changes a dataset's rows (see `Datasets.jsx` sync).
- `reportStore.isDirty` drives the unsaved-changes badge, the beforeunload guard, and Ctrl/Cmd+S save in `ReportBuilder`.
- Connector credentials (API headers, DB connection strings) are encrypted at rest; never log or display them.

## AntuNexus prototype (root `index.html`)

Static, zero-build mockup showcase for 8 AntuNexus applications (~2,160 lines: CSS design tokens in OKLCH, in-browser React 18 + Babel via CDN). Serve with any static server (`python3 -m http.server 8080`). Theming propagates via `data-app` attribute on `<html>` + per-app CSS custom property overrides. Persists view/app/mode in localStorage; listens for `__activate_edit_mode` postMessage from a parent design tool.
