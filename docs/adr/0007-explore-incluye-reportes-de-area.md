# Explorar incluye reportes de área además de reportes públicos

La página Explorar muestra dos tipos de reportes: los que tienen `isPublic: true` (visibles para cualquier usuario autenticado) y los publicados a un Área de la que el usuario es miembro (`areaId IN user_area_ids`). Ambos tipos se mezclan en una sola respuesta de `/reports/explore`, deduplicados por ID.

El cliente ofrece tabs de filtro local (Todo / Públicos / De mis áreas) sin llamadas adicionales al backend.

## Considered Options

- **Explorar solo reportes públicos**: descartado — los reportes de área son relevantes para el usuario y ya los puede ver en la tab Áreas del Dashboard, pero en Dashboard están agrupados por área sin búsqueda global ni favoritos de comunidad.
- **Endpoint separado `/reports/explore/areas`**: descartado — requeriría dos llamadas y dos grids, duplicando la lógica de favoritos y cards.
- **Mezclar en un solo endpoint con dedup (elegido)**: un reporte puede ser simultáneamente público y publicado a un área; el backend deduplica por ID antes de responder. El filtrado Todo/Públicos/Área es local en el cliente, sin roundtrip extra. Trade-off: la query de explore lee membresías del usuario, lo que añade una consulta extra (`areaMember.findMany`); aceptable dado que explore no es una ruta de alta frecuencia.
