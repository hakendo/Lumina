# Changelog — Lúmina

Todas las mejoras, correcciones y cambios notables del proyecto están documentados aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

---

## [Unreleased]

### CI/CD — Pipelines de deploy y provisioning para producción/staging

#### Agregado
- `azure-pipelines.yml` — build en agente + deploy vía WinRM a VM sin salida a internet.
- `azure-pipelines-provision.yml` — provisioning idempotente de servidores nuevos (IIS/ARR, Node, PostgreSQL, NSSM), manual/no-automático, con cache de instaladores entre runs.
- Gate obligatorio de `CHANGELOG.md` en el pipeline de deploy.
- `web.config` pasa a versionarse en `apps/frontend/public/` (antes vivía suelto en el servidor).

- Provisioning crea el rol y la base de Postgres que la app necesita (parseando `DATABASE_URL` del `.env` real), antes solo instalaba el motor con el superusuario.

#### Corregido
- pnpm en la VM de staging ahora se copia como `.exe` real del agente (antes copiaba un shim con paths relativos que no sobrevivía la copia).
- El deploy remoto llama pnpm por ruta completa (`C:\pnpm\pnpm.exe`) en vez de confiar en el PATH, que no siempre llega a una sesión WinRM recién abierta.
- El servicio de PostgreSQL fuerza `StartupType Automatic` en cada corrida de provisioning (había quedado en `Manual` en QA, tirando el backend tras un reboot).
- El deploy captura stdout/stderr de `pnpm install`/`prisma generate`/`prisma migrate deploy` como texto plano (`2>&1 | Out-String`) antes de chequear el exit code — PowerShell remoto truncaba el stderr nativo multilinea de node a una sola línea, perdiendo el mensaje real del error.
- Provisioning copia la carpeta `dist\` completa junto al `pnpm.exe` real (es un Node SEA, necesita `dist\pnpm.mjs` al lado — copiar solo el `.exe` rompía con `Cannot find module 'dist\pnpm.mjs'`). El chequeo de idempotencia ahora valida ambos archivos, no solo el `.exe` (si no, una instalación vieja incompleta quedaba marcada como "ya instalado" para siempre).
- El deploy ya no corre `pnpm install`/`prisma generate` en la VM (no tiene internet, iba a fallar apenas se resolvieran los bugs de pnpm) — ahora `node_modules` se instala y el Prisma Client se genera en el agente, se empaqueta (`tar.gz`) y se sube ya compilado; en la VM solo se descomprime y se corre `prisma migrate deploy`.
- El paso de creación de rol/DB de Postgres en provisioning ahora chequea el exit code de `psql` y muestra el error real (auth fallida, etc.) en vez de crashear con "cannot call a method on a null-valued expression" cuando la conexión fallaba silenciosamente.

---

## [0.5.0] — 2026-06-18

### Rendimiento — Agregación server-side, bulk upsert, connection pooling

#### Agregado
- **Motor de analítica server-side** (`analyticsEngine.js`): cache en memoria de rows por dataset (TTL 5 min), funciones `aggregate`, `getStats`, `getDistinctValues`. KPI widgets ahora computan aggregaciones en el servidor sin enviar todos los rows al browser.
- **Endpoints de analítica**:
  - `GET /datasets/:id/aggregate?field=X&op=sum&groupBy=Y` — agregación con filtros opcionales.
  - `GET /datasets/:id/stats?field=X` — estadísticas completas (sum, avg, min, max, median, count).
  - `GET /datasets/:id/distinct?field=X` — valores únicos de un campo.
- **Connection pooling para BD externas**: PostgreSQL, MySQL y SQL Server ahora reutilizan conexiones (pool de 3 conexiones por connection string, TTL 10 min, auto-cleanup cada 60s). Elimina overhead de handshake en syncs frecuentes.

#### Mejorado
- **Bulk upsert en `performSync`**: el modo upsert (con `idField`) ahora separa filas en listas de create/update/delete y ejecuta UPDATEs en lotes de 500 dentro de `$transaction`. Antes: 1 query secuencial por fila. Ahora: batches paralelos.
- **KPIWidget con doble fuente**: usa respuesta de `/aggregate` cuando disponible (server-side), fallback a computación client-side para reportes públicos.

---

## [0.4.0] — 2026-06-18

### Rendimiento — Virtualización, batching, paginación

#### Agregado
- **Virtualización de TableWidget**: los widgets de tabla ahora usan `@tanstack/react-virtual` para renderizar solo las filas visibles en el viewport. Soporta datasets de cientos de miles de filas sin impactar el DOM.
- **Paginación server-side en `GET /datasets/:id/rows`**: nuevo soporte para query params `?page=N&pageSize=N`. Sin parámetros mantiene compatibilidad con el comportamiento anterior (retorna todos los rows).
- **Contador de filas**: TableWidget muestra el total de filas del dataset.
- **Configuración pnpm**: agregado `pnpm-workspace.yaml` para soporte de pnpm como package manager.

#### Mejorado
- **Batch `createMany`**: la inserción de rows en sincronización y upload ahora se ejecuta en lotes de 5,000 filas en vez de un solo INSERT masivo. Aplica a:
  - Upload de archivos CSV/Excel
  - Sincronización de conectores API y DB (`performSync`)
  - Clonación de datasets en org admin
- **Hash de detección de cambios**: `hashRows()` ahora usa hashing incremental (streaming). Memoria O(1) en vez de O(n) — ya no serializa todo el dataset a un string gigante antes de hashear.

### Documentación

#### Agregado
- `docs/tech-stack.md` — Stack tecnológico completo con diagramas Mermaid (arquitectura, auth, data flow, ER, middleware, deploy).
- `docs/db-connector-data-flow.md` — Documentación detallada del flujo de datos para conectores de BD externa (registro, encriptación, sincronización, consumo en widgets).
- Página `/changelog` en la app para consultar el historial de versiones.

---

## [0.3.0] — 2026-06-17

### Agregado
- **Audit log de organizaciones**: registro obligatorio con razón para cambios de plan y estado de orgs (`OrgAuditLog`).
- **Perfil de usuario**: página `/profile` con cambio de contraseña.
- **Enforcement de org inactiva**: organizaciones desactivadas bloquean acceso a sus miembros.

### Corregido
- Query de reportes en admin: corregido error donde `User` no tiene columna `orgId` directa.
- Layout de `OrgPlanSelector`: select wrapeado en container `shrink-0` para evitar colapso.

---

## [0.2.0] — 2026-06-15

### Agregado
- **Multi-tenancy completo**: Organizations, Areas, Memberships, Area Policies.
- **Planes y políticas**: modelo `Plan` con límites (usuarios, storage, rate limits), políticas heredables Org → Area.
- **Páginas de reportes**: modelo `ReportPage` para reportes multi-página con layout y filtros independientes.
- **Templates de reportes**: `isTemplate` flag, clonación con slot bindings (`DatasetSlotBinding`).
- **Notificaciones**: modelo `Notification` con tipos y payload JSON.
- **Papelera**: soft-delete con `deletedAt` para datasets y reportes.
- **Roles org-scoped**: `OrgMembership.role` (member / org_admin) separado del rol global.
- **MFA (TOTP)**: setup con QR code, verificación obligatoria con `mfaEnforced`.

---

## [0.1.0] — 2026-06-09

### Agregado
- **Core BI**: upload CSV/Excel, conectores API y DB (PostgreSQL, MySQL, SQL Server, Oracle, Redis).
- **Report Builder**: canvas drag-and-drop con widgets (Chart, KPI, Table, Pivot, Map).
- **Autenticación JWT**: login, registro, middleware de verificación.
- **Compartir reportes**: links públicos con slug, shares por usuario (viewer/editor).
- **Export PDF**: renderizado headless con Puppeteer + merge multi-página con pdf-lib.
- **Favoritos**: sistema de favoritos por usuario.
- **Design system "mesa de luz"**: tokens en Tailwind v4, componentes compartidos en `ui.jsx`.
- **Encriptación at-rest**: AES-256-GCM para credenciales de conectores.
- **Protección SSRF**: validación de hosts públicos antes de requests a APIs externas.
- **Seguridad de queries**: solo SELECT permitido en conectores DB, whitelist read-only para Redis.
