# Plan tiers para límites operativos de organización

Los límites de retención, usuarios, visibilidad y rate limit de sync se modelan como un `Plan` con tiers predefinidos (consumer, enterprise, custom), no como config libre por org.

## Considered Options

- **Plan tiers con tier custom (chosen)**: cambiar un tier actualiza todos los orgs en ese plan. El tier `custom` es escape hatch para casos especiales.
- **Config libre por org**: superadmin configura cada org individualmente. Rechazado: propenso a inconsistencias en escala (40 orgs enterprise = 40 cambios manuales al ajustar un límite).

## Consequences

Las dimensiones del Plan son: `retentionDays`, `maxUsers`, `allowPublicLinks`, `allowExternalShare`, `syncRateLimit { maxPerMinute, maxPerHour, maxPerDay }`. El rate limit aplica solo a syncs de dataset contra fuentes externas, no a guardados de reporte. Dimensiones adicionales (`maxAreas`, `ssoEnabled`) quedan como `null` hasta que una feature las consuma.
