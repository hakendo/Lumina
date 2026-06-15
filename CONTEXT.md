# Lúmina

SaaS multi-tenant BI y reporting. Múltiples organizaciones independientes (tenants) coexisten en la misma instancia. Los datos de una organización nunca son visibles a otra, excepto al superadmin global.

## Tenancy y organización

**Organización**:
Una empresa o cliente independiente dentro de Lúmina. Unidad de aislamiento de datos: usuarios, áreas, datasets y reportes pertenecen a exactamente una organización. Creada y gestionada por el superadmin global.
_Avoid_: Tenant, empresa, cliente, cuenta, workspace

**Área**:
Un equipo o departamento dentro de una organización (ej: Ventas, Finanzas). Agrupa datasets y reportes publicados. Un miembro puede pertenecer a múltiples áreas de su organización. Tiene semántica de membresía: los miembros del área ven automáticamente sus reportes publicados.
_Avoid_: Carpeta, proyecto, espacio de trabajo, grupo

**Miembro de área**:
Relación entre un usuario y un área. Un usuario puede ser miembro de múltiples áreas dentro de su organización.
_Avoid_: Participante, colaborador

## Roles y permisos

**Superadmin**:
Operador global de Lúmina. Puede crear organizaciones, gestionar usuarios de cualquier organización, ver y modificar cualquier reporte, dataset o área. No pertenece a ninguna organización.
_Avoid_: Admin global, administrador del sistema

**Org Admin**:
Administrador de una organización específica. Puede crear áreas, invitar usuarios a la organización, gestionar miembros y ver todos los reportes y datasets de su organización.
_Avoid_: Admin de empresa, administrador de cliente

**Member**:
Usuario estándar. Pertenece a una organización y puede ser miembro de uno o más áreas dentro de ella. Puede crear datasets y reportes, publicar reportes a sus áreas.
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
