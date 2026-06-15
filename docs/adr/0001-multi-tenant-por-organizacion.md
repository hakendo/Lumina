# Multi-tenancy por Organización

Lúmina sirve múltiples empresas independientes (multi-tenant SaaS). Cada usuario pertenece a exactamente una Organización. Los datos de una organización son completamente invisibles para usuarios de otra, excepto al superadmin global. Decidimos contra auto-registro: las organizaciones solo las crea el superadmin, lo que mantiene el onboarding controlado y evita complejidad de planes/trials prematura.

## Considered Options

- **Single-tenant** (una instalación por empresa): descartado porque el objetivo es servir múltiples clientes desde una sola instancia.
- **Usuario en múltiples orgs**: descartado por la complejidad de sesiones por-org y riesgo de data leak cross-tenant sin beneficio claro en MVP.
