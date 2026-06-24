# Soft-delete de reportes y datasets con rows retenidas

Reportes y datasets eliminados entran a Papelera con `deletedAt` timestamp. Sus `DatasetRow` se retienen durante el período de retención del Plan de la org. El Org Admin y el Superadmin pueden restaurar o purgar manualmente.

## Considered Options

- **Soft-delete con rows retenidas (chosen)**: restauración completa — el dataset vuelve con todos sus datos. Costo en storage durante la retención, controlado por `Plan.storageLimitMB`.
- **Soft-delete solo metadata**: rows purgadas inmediatamente, solo se conserva config/schema. Rechazado: un dataset recuperado sin datos no cumple el caso de uso crítico (empleado borra datasets antes de irse).
- **Hard delete**: sin papelera. Rechazado explícitamente por el requerimiento de recuperación.

## Consequences

`Organization.storageUsedMB` no descuenta las rows en papelera — el storage en papelera sigue contando contra el límite del Plan. Esto incentiva al Org Admin a purgar la papelera. Una tarea programada expira y purga automáticamente el contenido cuyo `deletedAt` supera `Plan.retentionDays`.
