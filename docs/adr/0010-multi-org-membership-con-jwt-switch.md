# Multi-org membership con contexto de org en JWT

Un usuario puede pertenecer a múltiples organizaciones con roles distintos en cada una. El contexto de org activa viaja en el JWT; cambiar de org emite un nuevo token vía `/auth/switch-org`.

Se introduce `OrgMembership(userId, orgId, role)` como tabla pivote. `User.orgId` y el valor `org_admin` en `User.role` se eliminan; `User.role` queda solo para distinguir `superadmin` vs `member` (rol global).

## Considered Options

- **OrgMembership + JWT switch (chosen)**: rol por membresía, org activa firmada en token. El backend nunca confía en un orgId que no esté en el JWT; sin headers adicionales por request. Migración costosa pero modelo limpio.
- **User.orgId único + OrgMembership para orgs adicionales**: mantiene la org primaria en User. Rechazado: dos fuentes de verdad para el mismo concepto, complejidad de merge en queries.
- **X-Org-Id header por request**: el frontend envía el orgId en cada llamada; el backend valida contra membresías. Rechazado: más superficie de error en el cliente y no elimina la necesidad de validar en DB.

## Consequences

Todos los middlewares de autorización deben leer `req.user.orgId` del JWT (ya existente) y verificar que corresponde a una OrgMembership activa del usuario. La migración requiere poblar `OrgMembership` desde los `User.orgId` existentes antes de eliminar la columna.
