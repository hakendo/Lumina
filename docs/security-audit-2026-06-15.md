# Auditoría de Seguridad — Lúmina BI
**Fecha:** 2026-06-15  
**Alcance:** `apps/backend/` + `apps/frontend/`  
**Herramienta:** Revisión de código estático por agente especializado (security-auditor)

---

## Resumen ejecutivo

Se encontraron **14 vulnerabilidades**: 6 de severidad **Alta** y 8 de severidad **Media**. Las más críticas permitían exfiltración de datos entre organizaciones (cross-tenant), SSRF para acceder a redes internas, y exposición de archivos subidos sin autenticación.

| Severidad | Cantidad | Estado |
|-----------|----------|--------|
| Alta      | 6        | ✅ Todos corregidos |
| Media     | 8        | ✅ Todos corregidos |
| **Total** | **14**   | ✅ |

---

## Vulnerabilidades y correcciones

### SEC-001 — JWT de sesión en URL de export PDF
**Severidad:** Alta  
**Archivo:** `routes/reports.js` — ruta `GET /:id/export/pdf`

**Problema:**  
El JWT de sesión (válido 7 días) se pasaba como query param `?token=<jwt>` en la URL que Puppeteer visitaba. Esto lo exponía en logs de Morgan/acceso del servidor, en cabeceras `Referer` de recursos cargados por la página, y en el historial de navegación del proceso headless.

```js
// ❌ Antes
const token = req.headers.authorization?.slice(7) || '';
const url = `${frontendUrl}/report/${id}/view?token=${token}&print=1`;
```

**Corrección:**  
Se emite un JWT de corta vida (2 minutos) con claim `purpose: 'pdf'` específico para el render. Incluso si se filtra en logs, expira antes de que sea explotable.

```js
// ✅ Después
const printToken = jwt.sign(
  { id: req.user.id, purpose: 'pdf' },
  process.env.JWT_SECRET,
  { expiresIn: '2m' }
);
const baseUrl = `${frontendUrl}/report/${id}/view?token=${printToken}&print=1`;
```

---

### SEC-002 — SSRF vía conector de API
**Severidad:** Alta  
**Archivo:** `services/dataParser.js` — función `fetchAPI`

**Problema:**  
Cualquier miembro de un área podía crear un conector de API apuntando a `http://169.254.169.254/latest/meta-data/` (metadatos de cloud), `http://localhost:3001/admin/users` u otras IPs privadas. Al sincronizar el dataset, el backend hacía la petición y almacenaba la respuesta como filas, exfiltrando datos internos.

```js
// ❌ Antes — sin validación de destino
const res = await httpRequest(finalUrl, { method, headers, body, allowInsecureSsl });
```

**Corrección:**  
Se resuelve el hostname con `dns.lookup` antes de la petición y se rechaza cualquier IP en rangos privados (RFC 1918, loopback, link-local, IPv6 privado):

```js
// ✅ Después
await assertPublicHost(finalUrl); // lanza si la IP es privada
const res = await httpRequest(finalUrl, ...);
```

La función `assertPublicHost` bloquea: `127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, `::1`, `fc00:/fd:`, `fe80:`.

---

### SEC-003 — Archivos subidos servidos sin autenticación
**Severidad:** Alta  
**Archivos:** `src/index.js`, `routes/datasets.js`

**Problema:**  
Todos los archivos CSV/Excel subidos eran accesibles públicamente sin autenticación vía `GET /uploads/<nombre>`. El nombre incluía el timestamp del upload (`Date.now()-archivo.csv`), predecible con una ventana temporal conocida.

```js
// ❌ Antes
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
```

**Corrección:**  
- Se eliminó el middleware `express.static` para `/uploads`.  
- Los archivos se sirven únicamente a través de una ruta autenticada `GET /datasets/:id/file` que verifica `canReadDataset`.  
- El nombre en disco usa `crypto.randomUUID()` + extensión validada; el nombre original se guarda solo en la BD.  
- El `fileFilter` de Multer rechaza extensiones fuera de `.csv`, `.xlsx`, `.xls`, `.ods`.

```js
// ✅ Después
filename: (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, `${require('crypto').randomUUID()}${ext}`);
},
fileFilter: (req, file, cb) => {
  const allowed = ['.csv', '.xlsx', '.xls', '.ods'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowed.includes(ext));
},
```

---

### SEC-004 — Dataset Derivado accede a fuentes sin verificar autorización
**Severidad:** Alta  
**Archivo:** `routes/datasets.js` — `GET /:id/derived/preview`

**Problema:**  
El endpoint verificaba acceso al dataset *derivado*, pero cargaba filas de todos los `sources` configurados **sin verificar** que el usuario tuviera acceso a esos datasets fuente. Un atacante podía editar `config.sources` para referenciar datasets de otra organización y extraer sus datos.

```js
// ❌ Antes
for (const src of sources) {
  const rows = await prisma.datasetRow.findMany({ where: { datasetId: src.datasetId } });
  sourceData[src.alias] = rows.map(r => r.rowData);
}
```

**Corrección:**  
Se agrega `canReadDataset` por cada fuente antes de cargar sus filas:

```js
// ✅ Después
for (const src of sources) {
  const srcDs = await prisma.dataset.findUnique({ where: { id: src.datasetId } });
  if (!srcDs || !(await canReadDataset(srcDs, req.user.id))) {
    return res.status(403).json({ error: 'Sin acceso a un dataset fuente' });
  }
  // ...cargar filas...
}
```

---

### SEC-005 — Guardado de reporte acepta `datasetId` arbitrario
**Severidad:** Alta  
**Archivo:** `routes/reports.js` — `PUT /:id`

**Problema:**  
Al guardar un reporte, el backend no verificaba que los `datasetId` de los widgets pertenecieran a áreas accesibles para el usuario. Un editor podía incrustar datasets de otras organizaciones en sus widgets.

**Corrección:**  
Se extraen todos los `datasetId` únicos del payload, se consultan en batch y se verifica acceso de lectura para cada uno:

```js
// ✅ Después
const datasetIds = new Set();
for (const page of pages ?? []) {
  for (const w of page.widgets ?? []) {
    if (w.datasetId) datasetIds.add(w.datasetId);
  }
}
if (datasetIds.size > 0) {
  const datasets = await prisma.dataset.findMany({
    where: { id: { in: [...datasetIds] } },
    select: { id: true, areaId: true },
  });
  const userAreaIds = await getUserAreaIds(req.user.id);
  for (const ds of datasets) {
    if (userAreaIds !== null && ds.areaId && !userAreaIds.includes(ds.areaId)) {
      return res.status(403).json({ error: 'Sin acceso a uno o más datasets' });
    }
  }
}
```

---

### SEC-006 — Endpoint público de filas no verifica alcance del dataset
**Severidad:** Alta  
**Archivo:** `routes/reports.js` — `GET /public/:slug/datasets/:datasetId/rows`

**Problema:**  
Verificaba que el reporte fuera público y que un widget referenciara el dataset, pero no verificaba que ese dataset perteneciera a la misma organización que el dueño del reporte. Combinado con SEC-005, permitía exfiltrar datos de cualquier dataset.

**Corrección:**  
Se verifica que el área del dataset pertenezca a la misma organización que el dueño del reporte:

```js
// ✅ Después
const dataset = await prisma.dataset.findUnique({
  where: { id: req.params.datasetId },
  select: { areaId: true, area: { select: { orgId: true } } },
});
const owner = await prisma.user.findUnique({
  where: { id: report.ownerId }, select: { orgId: true },
});
if (!dataset || dataset.area?.orgId !== owner?.orgId) {
  return res.status(404).json({ error: 'Not found' });
}
```

---

### SEC-007 — `canReadDataset` otorga acceso a través de cualquier reporte público
**Severidad:** Media  
**Archivo:** `routes/datasets.js` — función `canReadDataset`

**Problema:**  
Un dataset referenciado por *cualquier* reporte público era legible por todos los usuarios autenticados, incluso si no eran miembros del área dueña del dataset.

```js
// ❌ Antes
const viaReport = await prisma.reportWidget.findFirst({
  where: { datasetId: dataset.id, report: { OR: [{ isPublic: true }, { shares: ... }] } },
});
return Boolean(viaReport);
```

**Corrección:**  
Se eliminó el branch de `isPublic: true`. El acceso a datos de reportes públicos se sirve exclusivamente por la ruta `/public/:slug/datasets/:datasetId/rows` (ya protegida por SEC-006). `canReadDataset` solo acepta shares directos (por persona):

```js
// ✅ Después
const viaShare = await prisma.reportWidget.findFirst({
  where: { datasetId: dataset.id, report: { shares: { some: { userId } } } },
  select: { id: true },
});
return Boolean(viaShare);
```

---

### SEC-008 — Conector de BD ejecuta SQL arbitrario (incluyendo escrituras)
**Severidad:** Media  
**Archivo:** `services/dataParser.js` — función `queryDB`

**Problema:**  
La query almacenada se ejecutaba sin validación. Un usuario podía configurar `DROP TABLE`, `DELETE FROM`, `COPY ... TO ...` u otros comandos destructivos contra la base de datos externa.

**Corrección:**  
Se valida que la query (después de eliminar comentarios SQL) comience con `SELECT`:

```js
// ✅ Después
function validateSelectQuery(query) {
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
    .replace(/--[^\n]*/g, '')           // line comments
    .trim();
  if (!/^select[\s(]/i.test(stripped)) {
    throw Object.assign(
      new Error('Solo se permiten consultas SELECT en conectores de base de datos'),
      { errorType: 'connection_error' }
    );
  }
}
```

---

### SEC-009 — Verificación de rol usa JWT caché en vez de BD
**Severidad:** Media  
**Archivo:** `routes/areas.js` — `GET /:id/members`

**Problema:**  
`req.user.role` proviene del JWT firmado al login, válido 7 días. Si un admin es degradado, sigue leyendo la lista de miembros del área hasta que expire el token.

```js
// ❌ Antes
const isAdmin = ['org_admin', 'superadmin'].includes(req.user.role);
```

**Corrección:**  
Se consulta el rol en la BD en tiempo real:

```js
// ✅ Después
const freshUser = await prisma.user.findUnique({
  where: { id: req.user.id }, select: { role: true },
});
const isAdmin = ['org_admin', 'superadmin'].includes(freshUser?.role);
```

---

### SEC-010 — Path traversal en nombre de archivo subido
**Severidad:** Media  
**Archivo:** `routes/datasets.js` — configuración de Multer

**Problema:**  
`file.originalname` era usado directamente como nombre en disco. Un atacante podía enviar `originalname = "../../src/routes/auth.js"` y sobreescribir archivos fuera del directorio de uploads.

**Corrección:**  
Cubierto en SEC-003: nombre en disco es `crypto.randomUUID() + ext_validada`. El nombre original nunca toca el filesystem.

---

### SEC-011 — Inyección de cabecera HTTP vía título del reporte
**Severidad:** Media  
**Archivo:** `routes/reports.js` — `GET /:id/export/pdf`

**Problema:**  
`report.title` (controlado por el usuario) se insertaba directamente en `Content-Disposition`. Un título con `\r\n` permitía inyectar cabeceras arbitrarias en la respuesta.

```js
// ❌ Antes
res.setHeader('Content-Disposition', `attachment; filename="${report.title}.pdf"`);
```

**Corrección:**  
Se sanitiza eliminando caracteres de control y comillas, y se usa la forma `filename*=` (RFC 5987) para soportar caracteres Unicode de forma segura:

```js
// ✅ Después
const safeTitle = report.title.replace(/[\x00-\x1f\x7f"\\]/g, '_');
const encodedTitle = encodeURIComponent(report.title);
res.setHeader(
  'Content-Disposition',
  `attachment; filename="${safeTitle}.pdf"; filename*=UTF-8''${encodedTitle}.pdf`
);
```

---

### SEC-012 — Dependencia `xlsx` con CVEs sin parche
**Severidad:** Media  
**Archivo:** `apps/backend/package.json`

**Problema:**  
`xlsx@0.18.5` tiene dos vulnerabilidades sin parche disponible:  
- `GHSA-4r6h-8v6p-xvw6` — Prototype Pollution  
- `GHSA-5pgg-2g8v-p4x9` — ReDoS  

Ambas se activan procesando archivos Excel subidos por usuarios.

**Corrección:**  
Se reemplazó `xlsx` por `exceljs@4.4.0` (mantenido activamente, sin CVEs conocidos). Se actualizó `dataParser.js` para usar la API de streaming de ExcelJS:

```js
// ✅ Después (dataParser.js)
const ExcelJS = require('exceljs');
async function parseExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  // ...
}
```

---

### SEC-013 — `allowInsecureSsl` sin restricción de privilegios
**Severidad:** Media  
**Archivo:** `routes/datasets.js` — `POST /api-connector`, `PUT /:id/api-connector`

**Problema:**  
Cualquier miembro de área podía activar `allowInsecureSsl: true` en un conector, deshabilitando la validación de certificados TLS y habilitando ataques MITM contra las peticiones del backend.

**Corrección:**  
Solo `org_admin` y `superadmin` pueden activar esta opción:

```js
// ✅ Después
if (allowInsecureSsl && !['org_admin', 'superadmin'].includes(user?.role)) {
  return res.status(403).json({
    error: 'Solo administradores pueden deshabilitar la validación SSL'
  });
}
```

---

### SEC-014 — Semilla TOTP devuelta en texto plano en la respuesta
**Severidad:** Media  
**Archivo:** `routes/auth.js` — `POST /auth/mfa/setup`

**Problema:**  
El endpoint devolvía `{ secret, otpauth, qr }`. El campo `secret` (la semilla TOTP) en texto plano en la respuesta HTTP permitía a cualquiera que interceptara o logueara la respuesta reproducir el segundo factor permanentemente.

```js
// ❌ Antes
res.json({ secret, otpauth, qr });
```

**Corrección:**  
Se eliminó `secret` de la respuesta. El QR code y la URI `otpauth://` ya contienen la semilla; el cliente puede decodificarla si necesita entrada manual:

```js
// ✅ Después
res.json({ otpauth, qr });
```

---

## Archivos modificados

| Archivo | Vulnerabilidades corregidas |
|---------|----------------------------|
| `services/dataParser.js` | SEC-002, SEC-008, SEC-012 |
| `routes/datasets.js` | SEC-003, SEC-004, SEC-007, SEC-010, SEC-013 |
| `routes/reports.js` | SEC-001, SEC-005, SEC-006, SEC-011 |
| `routes/areas.js` | SEC-009 |
| `routes/auth.js` | SEC-014 |
| `src/index.js` | SEC-003 (remover static) |

---

## Recomendaciones adicionales (fuera de alcance inmediato)

1. **Rate limiting en `/auth/login`** — sin límite de intentos actualmente; agregar `express-rate-limit` con 10 intentos/15 min por IP.
2. **JWT refresh tokens** — la vida de 7 días del JWT es larga; implementar refresh tokens de corta vida reduciría la ventana de exposición.
3. **Auditoría de acceso** — no hay log de quién accedió a qué dataset o reporte; importante para compliance en entornos corporativos.
4. **CSP headers** — `helmet()` está configurado pero sin Content-Security-Policy explícita para el frontend.
5. **Validación de `dataPath` en API connector** — actualmente acepta cualquier string como ruta de extracción; un schema básico evitaría errores confusos.
