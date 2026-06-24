# Herencia de plantillas mediante Dataset Slots (Estrategia C)

Cuando el superadmin asigna una plantilla base a un cliente, los datasets de la plantilla **no se clonan**. En su lugar, cada dataset marcado con `slotName` genera un `DatasetSlotBinding` con `clientDatasetId: null`. Los widgets del reporte derivado referencian el slot (`config.datasetSlot`) hasta que el cliente vincule su propia fuente. Una vez vinculado, el backend parchea `datasetId` en todos los widgets que usan ese slot.

## Alternativas consideradas

- **Estrategia A — Clonar datasets completos**: el cliente recibe una copia de los datos del superadmin. Descartada porque expone datos internos de la plantilla al cliente y obliga al superadmin a mantener datos de demostración.
- **Estrategia B — Referencias directas al dataset del superadmin**: los widgets del reporte derivado apuntan al dataset original. Descartada porque rompe el aislamiento multi-tenant — el cliente accedería a datos de otra organización.
- **Estrategia C (elegida) — Slots vacíos**: el cliente recibe la estructura del reporte sin datos. Mantiene el aislamiento total y obliga al cliente a conectar su propia fuente, que ya existe dentro de su área. Es el patrón que usa Power BI con parámetros de fuente.
