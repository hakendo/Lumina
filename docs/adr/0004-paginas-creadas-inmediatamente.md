# Páginas de reporte se crean/eliminan inmediatamente vía API

Cuando el usuario agrega o elimina una Página de Reporte en el builder, la operación se envía al backend de inmediato (`POST /reports/:id/pages`, `DELETE /reports/:id/pages/:pageId`). El ID real del servidor se usa desde el inicio; no se generan IDs temporales en el cliente. El guardado (`PUT /reports/:id`) solo actualiza contenido (layout, widgets, filtros) de páginas ya existentes.

## Considered Options

- **Diferido al guardar**: crear páginas localmente con `nanoid`, enviarlas todas en el `PUT`. Descartado porque el backend del `PUT` no aplica IDs provistos para páginas nuevas (siempre genera un cuid), lo que obliga a reconciliar IDs post-save y puede romper el estado activo si el usuario estaba en una página recién creada.
- **Inmediato (elegido)**: la página existe en BD antes de que el usuario guarde. Cada página tiene ID real desde el principio. El `PUT` es siempre un upsert sobre IDs conocidos. Trade-off: una página creada y abandonada sin guardar queda en BD sin widgets; aceptable porque no tiene costo real hasta que se le agreguen datos.
