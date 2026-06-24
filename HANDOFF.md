# Lúmina — Handoff 2026-06-17

Branch: `claude/company-website-cards-MVBkU`

---

## Estado general

App BI multi-tenant funcional. Backend Express + Prisma (PostgreSQL). Frontend React 19 + Vite + Tailwind v4.

**Cómo correr:**
```bash
npm install        # una vez en root
npm run dev        # backend (port 3001) + frontend (port 5173) concurrentes
```

**Credenciales de prueba:**
- Superadmin: `moises.cadima@antunexus.com`
- Org admin (STG Latam): `daniel.barraza@stgchile.cl` / `daniel.barraza@stgchile.cl`

---

## Lo implementado esta sesión

### 1. Storage tracking (`apps/backend/src/routes/datasets.js`)
- CSV upload → incrementa `Organization.storageUsedMB` con bytes reales de las filas
- Sync API/DB full-replace → delta (nuevos bytes − viejos bytes)
- Sync upsert → rastrea filas creadas/eliminadas inline
- Helper `rowBytes(rowData)` = `Buffer.byteLength(JSON.stringify(row), 'utf8')`

### 2. Policy key normalization (`apps/frontend/src/pages/OrgAdmin.jsx`)
- `GET /org/policy` devuelve `policyAllowPublicLink` (prefijado)
- UI usaba `allowPublicLink` (sin prefijo) → checkboxes siempre vacíos
- Fix: `normalizePolicy()` acepta ambos formatos con fallback chain
- `PolicyCard` muestra "✓ Guardado" (verde, 3s) o error en rojo al guardar

### 3. Enforcement de política en API (`apps/backend/src/routes/reports.js`)
- `getEffectivePolicy(report, orgId)`: area policy → org policy fallback
- `POST /:id/shares` → verifica `allowExternalShare`
- `POST /:id/share` → verifica `allowPublicLink` (solo al activar)
- `POST /:id/publish` → verifica `allowPublishToArea`

### 4. Fix plan selector Admin (`apps/frontend/src/pages/Admin.jsx`)
- `.field` CSS tiene `width: 100%` → rompía layout flex del header del org
- Fix: `<div className="shrink-0 w-36">` wrapper limita el `width:100%` al contenedor

### 5. Org activate/deactivate con auditoría
- `PATCH /admin/orgs/:id/status` → requiere `reason`, escribe `OrgAuditLog`
- `PATCH /admin/orgs/:orgId/plan` → requiere `reason`, escribe `OrgAuditLog`
- Schema: nuevo modelo `OrgAuditLog` (migration: `20260617234244_add_org_audit_log`)
- Frontend: `OrgReasonModal` (modal con textarea obligatorio antes de cualquier cambio)
- Tab "Auditoría" en panel de org: muestra historial con diff viejo→nuevo y motivo
- Ícono `eye-off` agregado a `ui.jsx`

### 6. Fix admin org reports (`apps/backend/src/routes/admin.js`)
- `GET /admin/orgs/:orgId/reports` filtraba por `owner.orgId` (campo inexistente en DB)
- Fix: query via `Report → Area → orgId` + OR para reportes sin área

### 7. Org inactiva enforcement
- `switch-org`: rechaza cambio a org inactiva (no-superadmin)
- `defaultMembership`: filtra `org.isActive=true` al login
- `orgAdmin` middleware: fetcha `org.isActive` junto con membership; bloquea si inactiva
- AppHeader: banner rojo cuando org activa está inactiva
- OrgSwitcher: orgs inactivas dimmed + no clickeables

### 8. Página de perfil (`/profile`)
- `PATCH /auth/me/password`: verifica contraseña actual → hashea nueva (≥8 chars)
- `Profile.jsx`: formulario cambio de contraseña + sección MFA
- MFA enable: QR → código de verificación (reutiliza `setupMfa`/`enableMfa` del authStore)
- MFA disable: pide código actual (bloqueado si `mfaEnforced`)
- Nombre de usuario en header = link a `/profile`

---

## Arquitectura clave (recordatorio)

```
User  ──── OrgMembership ──── Organization
             role: member|org_admin    isActive, planId, storageUsedMB
                                       policyAllow*

Report ──── Area ──── Organization     (Report.areaId nullable)
Widget ──── Dataset ──── Area

OrgAuditLog: orgId, adminId, action, oldValue, newValue, reason
```

**JWT:** lleva `{ id, email, role, orgId }`. `orgId` = org activa actual.  
**Rol en JWT:** el rol de org (member/org_admin) se embedea en el token, pero `orgAdmin.js` middleware revalida desde DB (no confía en JWT para decisiones de acceso).

**Proxy Vite:** `/auth`, `/admin`, `/org`, `/areas`, `/datasets`, `/reports`, `/notifications` → backend en `172.20.176.1:3001` (Windows host desde WSL2).

---

## Pendiente

### Alta prioridad
- **Registro de usuarios**: no existe `/register`. Diseño actual = admin crea usuarios vía `/admin/users`. ¿Intencional o falta implementar?
- **Forgot password**: no hay flujo. Requiere infraestructura SMTP — ¿disponible?

### Media prioridad
- **Enforcement de org inactiva para miembros regulares**: actualmente solo bloquea `orgAdmin` middleware y `switch-org`. Un miembro con JWT activo de org inactiva aún puede leer datasets/reports hasta que su token expire (7 días). Opciones:
  - Middleware `requireOrgActive` aplicado a `/datasets`, `/reports`, `/areas`
  - O reducir JWT TTL a 1h + refresh token

- **Cleanup: duplicate `req.user.orgId` vs `req.orgUser.orgId`**: `orgAdmin` middleware adjunta `req.orgUser.orgId` pero algunos handlers usan `req.user.orgId` directamente. Coherencia mejora mantenibilidad.

### Baja prioridad  
- **User profile — nombre propio**: actualmente no hay campo para que el usuario cambie su propio nombre
- **Notificaciones de cambios de org**: cuando org es desactivada/reactivada, notificar a miembros
- **Export PDF**: verificar que sigue funcionando con el nuevo sistema de páginas (ReportBuilder)
- **Datasets derivados**: `computeDerived` no actualiza `storageUsedMB` (correcto por diseño — son vistas calculadas, no almacenan filas)

---

## Archivos críticos modificados esta sesión

| Archivo | Cambio |
|---|---|
| `apps/backend/src/routes/datasets.js` | Storage tracking en upload/sync |
| `apps/backend/src/routes/reports.js` | `getEffectivePolicy` + 3 enforcement checks |
| `apps/backend/src/routes/admin.js` | Fix org reports query, audit log CRUD, org status toggle |
| `apps/backend/src/routes/auth.js` | `PATCH /me/password`, switch-org inactive check, defaultMembership filter |
| `apps/backend/src/middleware/orgAdmin.js` | Org inactive check |
| `apps/backend/prisma/schema.prisma` | Modelo `OrgAuditLog` |
| `apps/frontend/src/pages/Admin.jsx` | Reason modal, audit tab, plan selector fix, eye-off icon |
| `apps/frontend/src/pages/OrgAdmin.jsx` | `normalizePolicy`, PolicyCard feedback |
| `apps/frontend/src/pages/Profile.jsx` | **NUEVO** — perfil usuario |
| `apps/frontend/src/components/ui.jsx` | `eye-off` icon, AppHeader banner/link, OrgSwitcher inactive |
| `apps/frontend/src/store/authStore.js` | `disableMfa` action |
| `apps/frontend/src/App.jsx` | Ruta `/profile` |

---

## Commits de esta sesión (más recientes primero)

```
01d2931  Add user profile page, change-password endpoint, org inactive enforcement
86cca19  Fix admin org reports query: User has no orgId column
f5e93de  Add org audit log with mandatory reason for plan/status changes
c748456  Fix OrgPlanSelector layout: wrap select in shrink-0 container
75279f8  Enforce org policy in report routes, fix plan selector bug, add org toggle
f6235c4  Fix storage tracking and policy key normalization
```
