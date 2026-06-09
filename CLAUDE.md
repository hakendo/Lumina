# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AntuNexus — Cartas de Presentación** is a static, zero-build design system prototype and interactive mockup showcase for 8 AntuNexus applications. Everything lives in a single `index.html` file (~2,163 lines). There is no npm, no build step, and no tooling — open the file in a browser to run it.

## Running the App

No build or install steps. Open `index.html` directly:

```bash
# Any static server works, e.g.:
python3 -m http.server 8080
# Then open http://localhost:8080
```

There are no tests or linters configured.

## Architecture

The entire application is a single `index.html` with three sections:

1. **CSS (lines 10–732):** Design system tokens, component styles, device frames, dark/light mode. Colors use OKLCH color space via CSS custom properties (`--accent`, `--ink-1`, `--paper`, etc.). App-specific hues are declared as per-app overrides applied to `<html>` at runtime.

2. **JavaScript / React (lines 733–2163):** In-browser React 18 + Babel Standalone (both loaded from CDN — no local bundling). Component structure:
   - **Global config:** `THEME` object (activeApp, mode, density, radius) and `APPS` object defining 8 apps with distinct hues.
   - **Primitives:** `AntuLogo`, `Icon`, `StatusBar`, `DesktopChrome`, `AppBadge`, `Placeholder`
   - **Screen components per app (mobile/tablet/desktop):** `HubMobile`, `TelitaMobile`, `TelitaTablet`, `ComunidappMobile`, `ComunidappDesktop`, `PimtonexusMobile`, `PimtonexusDesktop`
   - **System views:** `DSShowcase` (design system docs), `ResponsiveView` (side-by-side device frames), `FlowView` (mobile flow demo)
   - **Shell:** `ProtoShell` — top-level component managing view switching, app selection, dark/light toggle, and localStorage persistence
   - **`TweaksPanel`:** Fixed overlay (bottom-right) for switching apps and modes at runtime

3. **Jekyll config (`_config.yml`):** 4-line file with project title/description; Jekyll is not actively used for templating.

## Theming System

App colors propagate through CSS inheritance:

1. `ProtoShell` sets `data-app="<appId>"` on `<html>` when user picks an app
2. Per-app CSS rules redefine `--accent`, `--accent-deep`, `--accent-muted`, `--accent-text` on `[data-app="<id>"]`
3. All components reference `var(--accent-*)` — no inline color values

The 8 apps and their OKLCH hues: AntuNexus (65°), Telita (25°), Telita Shop (350°), Comunidapp (155°), Pimtonexus (250°), Nexus ID (290°), Vantura (210°), Pórticos (45°).

## Persistence & Integration

- **localStorage:** saves active view, active app, and dark/light mode preference
- **postMessage API:** `ProtoShell` listens for `__activate_edit_mode` / `__deactivate_edit_mode` and `__edit_mode_set_keys` messages from a parent window (design tool integration)

## Deployment

The project deploys as a single static file. `site.zip` is an older backup snapshot; the canonical file is `index.html`.
