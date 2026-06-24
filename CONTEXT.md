# Lúmina

SaaS multi-tenant BI y reporting. Múltiples organizaciones independientes (tenants) coexisten en la misma instancia. Los datos de una organización nunca son visibles a otra, excepto al superadmin global.

## Tenancy y organización

**Organización**:
Una empresa o cliente independiente dentro de Lúmina. Unidad de aislamiento de datos: áreas, datasets y reportes pertenecen a exactamente una organización. Creada y gestionada por el superadmin global.
_Avoid_: Tenant, empresa, cliente, cuenta, workspace

**OrgMembership**:
Relación entre un usuario y una organización, que lleva el rol del usuario dentro de esa org (`member` u `org_admin`). Un usuario puede tener membresías en múltiples organizaciones con roles distintos en cada una. Reemplaza a `User.orgId` y `User.role` para el contexto org.
_Avoid_: Membresía, pertenencia a org, rol de org

**Org activa**:
La organización en cuyo contexto opera la sesión actual del usuario. Se codifica en el JWT al hacer login o al cambiar de org. Todos los requests del backend validan permisos contra la org activa del token. El usuario cambia su org activa llamando a `/auth/switch-org`, que emite un nuevo JWT.
_Avoid_: Organización actual, contexto de org, tenant activo

**Área**:
Un equipo o departamento dentro de una organización (ej: Ventas, Finanzas). Agrupa datasets y reportes publicados. Un miembro puede pertenecer a múltiples áreas de su organización. Tiene semántica de membresía: los miembros del área ven automáticamente sus reportes publicados.
_Avoid_: Carpeta, proyecto, espacio de trabajo, grupo

**Miembro de área**:
Relación entre un usuario y un área. Un usuario puede ser miembro de múltiples áreas dentro de su organización.
_Avoid_: Participante, colaborador

## Roles y permisos

**Superadmin**:
Operador global de Lúmina. Puede crear organizaciones, gestionar usuarios de cualquier organización, ver y modificar cualquier reporte, dataset o área. No pertenece a ninguna organización; `User.role = 'superadmin'` es su único identificador.
_Avoid_: Admin global, administrador del sistema

**Org Admin**:
Rol dentro de una OrgMembership (`OrgMembership.role = 'org_admin'`). Puede gestionar usuarios de su organización: agregarlos a áreas, cambiar privacidad de reportes, clonar reportes y datasets, deshabilitar cuentas y forzar MFA. Su scope es estrictamente la org de la membresía activa.
_Avoid_: Admin de empresa, administrador de cliente

**Member**:
Rol dentro de una OrgMembership (`OrgMembership.role = 'member'`). Puede ser miembro de uno o más áreas dentro de su org activa. Puede crear datasets y reportes, publicar reportes a sus áreas.
_Avoid_: Usuario, colaborador, analista

## Datos

**Dataset**:
Fuente de datos propiedad de un área. Puede ser CSV, Excel, API, conector de base de datos, o un Dataset Derivado. Pertenece a un área; si el usuario que lo subió se va, el dataset permanece.
_Avoid_: Fuente de datos, tabla, archivo

**Dataset Derivado**:
Un dataset persistente creado combinando uno o más datasets mediante joins, filtros y columnas calculadas. Equivale a un Dataflow de PowerBI. Se almacena como un dataset más con `sourceType: 'derived'` y su lógica de transformación en `config`.
_Avoid_: Dataset calculado, vista, dataset virtual, dataset transformado

**Columna Calculada**:
Campo nuevo definido mediante una expresión sobre columnas existentes de un dataset (ej: `margen = ingresos - costos`). Se persiste en la config del Dataset Derivado.
_Avoid_: Campo calculado, medida, fórmula

## Reportes

**Reporte**:
Documento de visualización compuesto por páginas y widgets. Propiedad del usuario que lo crea. Nace como privado y puede publicarse a un área.
_Avoid_: Dashboard, informe, panel

**Página de Reporte**:
Una pestaña dentro de un reporte con su propio canvas, layout y filtros. Un reporte tiene una o más páginas (ej: Resumen, Detalle, Tendencias).
_Avoid_: Tab, pestaña, vista, hoja

**Widget**:
Elemento visual dentro de una página de reporte (gráfico, KPI, tabla, pivot, mapa). Tiene un dataset asociado y configuración de visualización.
_Avoid_: Componente, tarjeta, bloque, visualización

**Publicar al área**:
Acción de mover un reporte de estado privado a visible para todos los miembros de un área específica. Un reporte solo puede publicarse a un área a la vez.
_Avoid_: Compartir con área, hacer público al área

**Cross-filtering**:
Interacción entre widgets de la misma página donde la selección en un widget (ej: click en una barra) filtra automáticamente los demás widgets de la página.
_Avoid_: Filtro cruzado, drill-through interactivo

## Compartir

**Compartir por persona**:
Invitar a un usuario específico (por email) a ver o editar un reporte, independientemente de su área. Mecanismo complementario al área.
_Avoid_: Share individual, invitación directa

**Link público**:
URL anónima (via slug) que permite a cualquier persona ver un reporte sin tener cuenta en Lúmina.
_Avoid_: Share público, URL de acceso, enlace externo

## Planes y límites

**Plan**:
Tier de servicio asignado a una organización por el superadmin. Controla: `retentionDays` (días en papelera), `maxUsers` (usuarios activos), `storageLimitMB` (storage total de DatasetRows), `allowPublicLinks`, `allowExternalShare`, y `syncRateLimit { maxPerMinute, maxPerHour, maxPerDay }`. Los tiers predefinidos (consumer, enterprise, …) fijan valores; el tier `custom` permite config libre por org.
_Avoid_: Tier, suscripción, licencia, paquete

**Storage usado**:
Suma acumulada en MB del tamaño JSON de todas las `DatasetRow` activas (no en papelera) de una organización. Se actualiza en cada sync, delete y purga. Se almacena como `Organization.storageUsedMB`. El Plan define el límite máximo (`storageLimitMB`); superar el límite bloquea nuevos syncs hasta que el cliente amplíe su plan.
_Avoid_: Espacio ocupado, uso de disco, cuota de datos

**Rate limit de sync**:
Restricción sobre cuántas veces pueden sincronizarse los datasets de una organización en un período (por minuto, hora y/o día). Configurado a nivel de Plan. `null` en cualquier ventana significa sin límite. Solo aplica a syncs contra fuentes externas (API, DB), no a guardados de reporte.
_Avoid_: Límite de actualización, throttle, cuota de sync

**Papelera**:
Estado de un Reporte o Dataset eliminado por el usuario. El contenido en papelera no es visible en el dashboard ni en el explorador, pero persiste en DB con `deletedAt` — incluyendo todas sus `DatasetRow` — hasta que expira `Plan.retentionDays` o el Org Admin lo purga manualmente. Solo el Org Admin y el Superadmin pueden ver y restaurar contenido en papelera.
_Avoid_: Archivado, eliminado, trash, contenido borrado

## Políticas de contenido

**Política de área**:
Conjunto de reglas que gobiernan qué operaciones de visibilidad están permitidas sobre el contenido que vive en un área específica. La define el Org Admin. Las dimensiones controlables son: permitir link público, permitir compartir por persona fuera de la org, permitir publicar al área, permitir crear reportes. Un área sin política explícita hereda la Política de org.
_Avoid_: Permisos de área, configuración de área, restricciones de área

**Política de org**:
Política default de la organización. Aplica a borradores privados (reportes sin área asignada) y a áreas que no tienen política propia. La define el Org Admin.
_Avoid_: Política global, política default, reglas de organización

## Plantillas y herencia

**Plantilla base**:
Reporte modelo marcado con `isTemplate: true`, gestionado exclusivamente por el superadmin. No aparece en el dashboard de ningún cliente. Sirve para crear Reportes Derivados idénticos en estructura para distintos clientes.
_Avoid_: Template, modelo de reporte, reporte base

**Reporte derivado**:
Reporte creado a partir de una Plantilla base mediante la operación de asignación. El cliente es propietario del reporte derivado; la estructura (páginas, widgets, config) es copia de la plantilla. Apunta a la plantilla de origen mediante `templateId`.
_Avoid_: Reporte clonado, instancia de plantilla

**Dataset Slot**:
Dataset de plantilla marcado con un `slotName` (ej: `ventas_api`). Cuando la plantilla se asigna a un cliente, no se clona el dataset; en su lugar se crea un DatasetSlotBinding con `clientDatasetId: null`. Los widgets usan `config.datasetSlot` hasta que el cliente configure su propia fuente.
_Avoid_: Placeholder de dataset, slot de datos

**DatasetSlotBinding**:
Registro que vincula un slot de una Plantilla base con el dataset real del cliente dentro de un Reporte Derivado. Un binding pendiente (`clientDatasetId: null`) indica que el cliente aún no configuró esa fuente. Una vez vinculado, todos los widgets que referencian ese slot actualizan su `datasetId`.
_Avoid_: Enlace de slot, configuración de fuente

## Sincronización de datos

**Sync**:
Operación de obtener datos frescos de la fuente externa (API o DB) y almacenarlos en `DatasetRow`. Los datos en Lúmina son siempre una snapshot del momento del último sync; las visualizaciones leen de la DB, no de la fuente en vivo.
_Avoid_: Actualización, refresh, pull

**Campo ID (idField)**:
Columna del dataset designada como clave única por el usuario durante el primer sync. Cuando está configurada, syncs posteriores hacen upsert fila a fila en lugar de borrar y reinsertar todo. Valor `null` = el usuario eligió explícitamente no tener campo ID. Ausencia de la clave en config = nunca configurado (muestra el modal de configuración).
_Avoid_: Primary key, clave primaria, campo único

**Sync masivo**:
Operación `POST /datasets/sync-all` que sincroniza todos los datasets API/DB accesibles al usuario en una sola llamada. Retorna un resumen de cuántos se actualizaron, cuántos quedaron sin cambios y cuántos fallaron.
_Avoid_: Bulk sync, actualización masiva
