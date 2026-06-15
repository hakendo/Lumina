# PDF multi-página: una URL por página + merge con pdf-lib

El export PDF de un reporte con múltiples Páginas de Reporte se genera así:
1. El backend obtiene los IDs de las páginas en orden.
2. Puppeteer abre una pestaña de navegador por página, navegando a `/report/:id/view?print=1&pageId=<id>`.
3. Cada pestaña produce un buffer PDF independiente (A4 landscape).
4. `pdf-lib` copia todas las páginas PDF en un único documento y lo devuelve al cliente.

`ReportView` lee el parámetro `?pageId=` en print mode y activa esa página antes de que Puppeteer capture la pantalla.

## Considered Options

- **Un solo Puppeteer + click en tabs**: Puppeteer navega a la URL del reporte y hace click en cada tab para luego capturar. Descartado — las tabs son botones React con estado; Puppeteer tendría que esperar rehidratación + render de charts ECharts en cada cambio, haciendo el timing frágil y dependiente de `waitFor` heurísticos.
- **`page.pdf()` con `pageBreaks` CSS**: inyectar `@page { break-after: always }` entre secciones. Descartado — las páginas del reporte son completamente independientes (distinto layout, distintos widgets); no están en el mismo DOM.
- **URL por página + merge (elegido)**: cada página se renderiza en su propio contexto de navegador limpio. El merge con `pdf-lib` es determinista y no depende de timing de charts. Trade-off: N llamadas a Puppeteer en lugar de 1 (típicamente 2–5 páginas; aceptable para uso interactivo).
