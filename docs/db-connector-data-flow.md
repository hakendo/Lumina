# Flujo de Datos: Conector de Base de Datos Externa

Documentación del ciclo de vida completo de los datos cuando un usuario conecta una base de datos de terceros a Lúmina.

---

## 1. Vista General del Flujo

```mermaid
sequenceDiagram
    participant U as Usuario (Browser)
    participant FE as Frontend (React)
    participant BE as Backend (Express)
    participant ENC as encryption.js
    participant DP as dataParser.js
    participant DB_EXT as BD Externa (tercero)
    participant PRS as Prisma ORM
    participant PG as PostgreSQL (Lúmina)

    Note over U,PG: FASE 1 — Registro del conector

    U->>FE: Configura conexión (tipo, conn string, query)
    FE->>BE: POST /datasets/db-connector
    BE->>BE: Validación (name, dbType, query, permisos)
    BE->>ENC: encrypt({ connectionString })
    ENC-->>BE: token AES-256-GCM (base64)
    BE->>PRS: dataset.create({ sourceType: 'db', config })
    PRS->>PG: INSERT Dataset
    PG-->>BE: Dataset creado (sin datos aún)
    BE-->>FE: { id, name, config (sin _enc) }

    Note over U,PG: FASE 2 — Sincronización (fetch)

    U->>FE: Click "Sincronizar"
    FE->>BE: POST /datasets/:id/fetch
    BE->>BE: syncRateLimit middleware
    BE->>DP: queryDB(dataset.config)
    DP->>ENC: decrypt(config._enc)
    ENC-->>DP: { connectionString }
    DP->>DP: validateSelectQuery(query)
    DP->>DB_EXT: Ejecuta SELECT query
    DB_EXT-->>DP: rows[]
    DP-->>BE: rows[] (objetos planos)

    BE->>BE: hashRows(rows) → SHA-256

    alt Hash igual al anterior
        BE-->>FE: { unchanged: true }
    else Hash diferente
        alt idField configurado (upsert mode)
            BE->>PG: UPDATE/INSERT/DELETE por idField
        else Sin idField (full replace)
            BE->>PG: DELETE ALL + createMany
        end
        BE->>PG: UPDATE Dataset.config (dataHash, lastSyncStatus)
        BE->>PG: UPDATE Org.storageUsedMB (delta)
        BE-->>FE: { count, columns }
    end

    Note over U,PG: FASE 3 — Consumo en widgets

    U->>FE: Abre ReportBuilder
    FE->>BE: GET /datasets/:id/rows
    BE->>PG: SELECT DatasetRow WHERE datasetId ORDER BY rowIndex
    PG-->>BE: rows[]
    BE-->>FE: rows[].rowData (JSON plano)
    FE->>FE: CACHE[datasetId] = rows
    FE->>FE: applyFilters() → widget render
```

---

## 2. Fase 1: Registro del Conector

### 2.1 Endpoint

```
POST /datasets/db-connector
```

**Archivo:** `apps/backend/src/routes/datasets.js:352`

### 2.2 Payload del request

```json
{
  "name": "Ventas Q1",
  "areaId": "clx...",
  "dbType": "mssql",
  "connectionString": "Server=10.0.1.5;Database=ERP;User Id=reader;Password=xxx",
  "query": "SELECT fecha, monto, cliente FROM ventas WHERE año = 2026",
  "slotName": "ventas-source"
}
```

### 2.3 Tipos de BD soportados

```mermaid
graph LR
    subgraph Drivers["Drivers soportados"]
        PG["pg<br/>PostgreSQL"]
        MySQL["mysql2<br/>MySQL / MariaDB"]
        MSSQL["mssql<br/>SQL Server"]
        Oracle["oracledb<br/>Oracle"]
        Redis["ioredis<br/>Redis"]
    end

    subgraph Validación["Validación de query"]
        SQL_CHECK["validateSelectQuery()<br/>Solo SELECT permitido<br/>(strip comments, regex check)"]
        REDIS_CHECK["RO_COMMANDS whitelist<br/>get, hgetall, lrange,<br/>smembers, keys, scan..."]
    end

    PG --> SQL_CHECK
    MySQL --> SQL_CHECK
    MSSQL --> SQL_CHECK
    Oracle --> SQL_CHECK
    Redis --> REDIS_CHECK

    style Validación fill:#fef3c7,stroke:#d97706
```

### 2.4 Encriptación de credenciales

```mermaid
flowchart LR
    CS["connectionString<br/>(plaintext)"] --> ENC["encrypt()"]
    ENC --> TOKEN["base64(IV + AuthTag + Ciphertext)"]
    TOKEN --> CONFIG["Dataset.config._enc"]
    CONFIG --> DB[("PostgreSQL")]

    subgraph Crypto["AES-256-GCM"]
        KEY["ENCRYPTION_KEY<br/>(env var, 64 hex chars = 32 bytes)"]
        IV["IV random<br/>(16 bytes)"]
        TAG["AuthTag<br/>(16 bytes, integridad)"]
    end

    KEY --> ENC
    IV --> ENC
    ENC --> TAG

    style Crypto fill:#fce7f3,stroke:#db2777
```

**Archivo:** `apps/backend/src/services/encryption.js`

Lo que se guarda en `Dataset.config`:

```json
{
  "dbType": "mssql",
  "query": "SELECT ...",
  "_enc": "base64(iv+tag+ciphertext)"
}
```

- `_enc` contiene `{ connectionString }` cifrado
- Nunca sale al frontend — `safeConfig()` lo stripea antes de responder
- Cada encrypt genera IV aleatorio, mismo plaintext → distinto ciphertext

### 2.5 Validaciones de seguridad

| Check | Ubicación | Detalle |
|-------|-----------|---------|
| dbType válido | `datasets.js:350` | Whitelist: `pg`, `mysql`, `mssql`, `oracle`, `redis` |
| Solo SELECT | `dataParser.js:204` | Strip comments SQL, regex `^select[\s(]` |
| Redis read-only | `dataParser.js:250` | Whitelist de ~30 comandos RO |
| Permisos de área | `datasets.js:364` | `areaMember` check o superadmin |
| Rate limit | `syncRateLimit.js` | Por plan: maxPerMinute/Hour/Day |
| Storage limit | `syncRateLimit.js:33` | `storageUsedMB >= plan.storageLimitMB` |

---

## 3. Fase 2: Sincronización de Datos

### 3.1 Trigger

```
POST /datasets/:id/fetch
```

**Archivo:** `apps/backend/src/routes/datasets.js:604`

Middleware chain: `auth → syncRateLimit → handler`

### 3.2 Resolución de credenciales

```mermaid
flowchart TB
    Config["Dataset.config<br/>(de PostgreSQL)"] --> Resolve["resolveConfig()"]
    Resolve --> Decrypt["decrypt(config._enc)"]
    Decrypt --> Merge["Merge: { dbType, query, connectionString }"]
    Merge --> Driver["Driver específico"]

    style Resolve fill:#e0e7ff,stroke:#4f46e5
```

**Archivo:** `apps/backend/src/services/dataParser.js:36`

`resolveConfig()` descifra `_enc` y lo mergea con los campos públicos. Resultado: objeto con `dbType`, `connectionString`, `query` en texto plano, solo en memoria del proceso.

### 3.3 Ejecución de query por driver

```mermaid
flowchart TB
    QDB["queryDB(config)"] --> RC["resolveConfig()"]
    RC --> SW{dbType?}

    SW -->|redis| REDIS["ioredis<br/>client.call(cmd, ...args)"]
    SW -->|mysql| MYSQL["mysql2/promise<br/>conn.execute(query)"]
    SW -->|mssql| MSSQL["mssql<br/>pool.request().query(query)"]
    SW -->|oracle| ORACLE["oracledb<br/>conn.execute(query, [], OUT_FORMAT_OBJECT)"]
    SW -->|pg| PGEXT["pg Client<br/>client.query(query)"]

    REDIS --> NORM_R["normalizeRedisReply()<br/>→ [{key, value}] ó [{index, value}]"]
    MYSQL --> ROWS["rows[]"]
    MSSQL --> RS["result.recordset"]
    ORACLE --> OR["result.rows"]
    PGEXT --> PR["result.rows"]

    NORM_R --> OUT["Array de objetos planos"]
    ROWS --> OUT
    RS --> OUT
    OR --> OUT
    PR --> OUT

    style QDB fill:#d1fae5,stroke:#059669
```

**Archivo:** `apps/backend/src/services/dataParser.js:234-318`

Cada driver:
1. Obtiene conexión del pool (PostgreSQL, MySQL, SQL Server) o abre conexión efímera (Oracle, Redis)
2. Ejecuta query
3. Retorna conexión al pool (o cierra en `finally` para efímeras)
4. Retorna array de objetos planos `[{ col1: val1, col2: val2 }, ...]`

**Connection pooling** (v0.5.0): PostgreSQL (`pg.Pool`), MySQL (`mysql2.createPool`), y SQL Server (`mssql.connect`) reutilizan conexiones. Key = `dbType + MD5(connectionString)`. Pool de 3 conexiones, TTL 10 min, cleanup automático cada 60s. Oracle y Redis mantienen conexiones efímeras.

### 3.4 Normalización de datos

Todos los drivers convergen al mismo formato de salida: **array de objetos planos**.

```
[
  { "fecha": "2026-01-15", "monto": 1500.00, "cliente": "Acme Corp" },
  { "fecha": "2026-01-16", "monto": 2300.50, "cliente": "Globex" },
  ...
]
```

Para Redis, `normalizeRedisReply()` convierte las distintas formas de respuesta:

| Comando Redis | Respuesta raw | Normalizado |
|--------------|---------------|-------------|
| `GET key` | `"value"` | `[{ value: "value" }]` |
| `HGETALL key` | `{ f1: v1, f2: v2 }` | `[{ field: "f1", value: "v1" }, ...]` |
| `LRANGE key 0 -1` | `["a", "b", "c"]` | `[{ index: 0, value: "a" }, ...]` |

### 3.5 Detección de cambios (hash)

```mermaid
flowchart LR
    ROWS["rows[]"] --> LOOP["for (row of rows)"]
    LOOP --> SORT["Sort keys"]
    SORT --> UPDATE["hash.update(<br/>JSON.stringify(row))"]
    UPDATE --> LOOP
    LOOP -->|"done"| DIGEST["hash.digest('hex')<br/>.slice(0, 16)"]
    DIGEST --> CMP{"== config.dataHash?"}
    CMP -->|Sí| SKIP["unchanged: true<br/>(no write)"]
    CMP -->|No| PERSIST["Persistir rows"]

    style CMP fill:#818cf8,stroke:#3730a3,color:#fff
```

**Archivo:** `apps/backend/src/routes/datasets.js:527-534`

Hash incremental (streaming): cada row se hashea individualmente con `hash.update()`. Memoria O(1) — no serializa todo el dataset a un string. Keys se ordenan para que `{a:1, b:2}` y `{b:2, a:1}` produzcan el mismo hash. Truncado a 16 chars hex.

### 3.6 Persistencia: dos modos

```mermaid
flowchart TB
    CHECK{"idField<br/>configurado?"}

    CHECK -->|Sí + existe en rows| UPSERT["UPSERT MODE"]
    CHECK -->|No / undefined| REPLACE["FULL REPLACE MODE"]

    subgraph UPSERT["Upsert por idField"]
        U1["Map existentes por idField value"]
        U2["Para cada row nueva:<br/>- Key existe → UPDATE<br/>- Key nueva → CREATE"]
        U3["Keys faltantes → DELETE"]
        U1 --> U2 --> U3
    end

    subgraph REPLACE["Full Replace"]
        R1["Calcular delta bytes (old vs new)"]
        R2["DELETE ALL DatasetRow WHERE datasetId"]
        R3["batchCreateRows()<br/>(lotes de 5,000 filas)"]
        R1 --> R2 --> R3
    end

    UPSERT --> STORAGE["updateOrgStorage(delta bytes)"]
    REPLACE --> STORAGE
    STORAGE --> META["UPDATE Dataset.config:<br/>dataHash, lastSyncStatus: 'ok'"]

    style CHECK fill:#fbbf24,stroke:#92400e
```

**Archivo:** `apps/backend/src/routes/datasets.js:549-601`

#### idField (campo de deduplicación)

- Configurable por el usuario tras primer sync (`PATCH /:id/id-field`)
- Si `idField = "invoice_id"`, cada row se identifica por ese campo
- Upsert: UPDATE existentes, INSERT nuevos, DELETE los que ya no vienen
- Tracking granular de storage bytes (solo deltas)

#### Full Replace (default)

- Sin idField → borra todo y re-inserta
- Inserción en lotes de 5,000 filas (`batchCreateRows()`) para evitar statements SQL masivos
- Calcula delta de bytes para ajustar `storageUsedMB`

### 3.7 Modelo de almacenamiento en PostgreSQL

```mermaid
erDiagram
    Dataset ||--o{ DatasetRow : "1:N"

    Dataset {
        string id PK
        string sourceType "db"
        json config "{ dbType, query, _enc, dataHash, idField, lastSyncStatus, lastSyncError }"
        string areaId FK
        string uploadedById FK
    }

    DatasetRow {
        string id PK
        string datasetId FK
        json rowData "{ col1: val1, col2: val2, ... }"
        int rowIndex "orden original"
    }
```

Cada fila de la BD externa se guarda como **un registro `DatasetRow`** con `rowData` = JSON del row completo. No hay schema fijo — columnas son dinámicas.

---

## 4. Fase 3: Consumo en Widgets

### 4.1 Obtención de rows

```
GET /datasets/:id/rows                    → todos los rows (backward compat)
GET /datasets/:id/rows?page=1&pageSize=1000  → paginado server-side
```

**Archivo:** `apps/backend/src/routes/datasets.js:629`

Sin parámetros, retorna `DatasetRow[].rowData` ordenado por `rowIndex` (array plano):

```json
[
  { "fecha": "2026-01-15", "monto": 1500, "cliente": "Acme" },
  { "fecha": "2026-01-16", "monto": 2300, "cliente": "Globex" }
]
```

Con paginación (`?page=1&pageSize=1000`), retorna objeto con metadata:

```json
{
  "rows": [{ "fecha": "...", "monto": 1500 }],
  "page": 1,
  "pageSize": 1000,
  "total": 85432,
  "pages": 86
}
```

`pageSize` máximo: 50,000. Default: 10,000.

### 4.2 Cache en frontend

```mermaid
flowchart TB
    WR["WidgetRenderer.jsx<br/>monta con widget.datasetId"]
    WR --> CHECK{"CACHE[dsId]<br/>existe?"}

    CHECK -->|Sí| USE["Usa rows del cache"]
    CHECK -->|No| PENDING_CHECK{"PENDING[dsId]<br/>existe?"}

    PENDING_CHECK -->|Sí| WAIT["Espera Promise existente<br/>(deduplicación)"]
    PENDING_CHECK -->|No| FETCH["api.get(/datasets/:id/rows)<br/>crea PENDING[dsId] = Promise"]

    FETCH --> RESOLVE["CACHE[dsId] = rows<br/>delete PENDING[dsId]"]
    WAIT --> RESOLVE
    RESOLVE --> USE

    USE --> FILTER["applyFilters()<br/>(filters, crossFilters, drillFilters)"]
    FILTER --> WIDGET["ChartWidget / KPIWidget /<br/>TableWidget / PivotWidget / MapWidget"]

    style CHECK fill:#818cf8,stroke:#3730a3,color:#fff
    style PENDING_CHECK fill:#818cf8,stroke:#3730a3,color:#fff
```

**Archivos:**
- `apps/frontend/src/components/Canvas/WidgetRenderer.jsx`
- `apps/frontend/src/lib/datasetCache.js`

Puntos clave:
- **Cache module-level** (`CACHE` object) — compartido entre todos los widgets del reporte
- **Deduplicación** — si 5 widgets usan el mismo dataset, solo 1 fetch HTTP
- **`invalidateDatasetCache(datasetId)`** — se llama después de sync para forzar refetch
- Cache vive mientras la SPA no recarga — no persiste en localStorage

### 4.3 Filtrado

```mermaid
flowchart LR
    RAW["rows[] (del cache)"] --> AF["applyFilters()"]

    subgraph Inputs["Fuentes de filtro"]
        GF["filters<br/>(FilterBar global)"]
        FV["filterValues<br/>(valores seleccionados)"]
        CF["crossFilters<br/>(click en chart → filtra otros)"]
        DF["drillFilters<br/>(drill-through entre páginas)"]
    end

    GF --> AF
    FV --> AF
    CF --> AF
    DF --> AF

    AF --> FILTERED["rows[] filtradas"]
    FILTERED --> WIDGET["Widget render"]

    style AF fill:#d1fae5,stroke:#059669
```

**Archivo:** `apps/frontend/src/store/reportStore.js` — función `applyFilters()`

Filtrado ocurre **100% en el frontend**, en memoria. No hay query parametrizada al backend — todos los rows se cargan y filtran client-side.

### 4.4 Rendering por tipo de widget

```mermaid
flowchart TB
    DATA["rows[] filtradas"] --> TYPE{widgetType}

    TYPE -->|chart| CHART["ChartWidget<br/>ECharts 6<br/>(lazy-loaded ~300KB)"]
    TYPE -->|kpi| KPI["KPIWidget<br/>Cálculos aritméticos<br/>(sum, avg, count, min, max)"]
    TYPE -->|table| TABLE["TableWidget<br/>@tanstack/react-virtual<br/>(filas virtualizadas, render solo viewport)"]
    TYPE -->|pivot| PIVOT["PivotWidget<br/>Pivot table<br/>(group by rows × columns)"]
    TYPE -->|map| MAP["MapWidget<br/>Leaflet 1.9<br/>(lazy-loaded ~45KB)"]

    CHART --> RENDER["DOM render"]
    KPI --> RENDER
    TABLE --> RENDER
    PIVOT --> RENDER
    MAP --> RENDER

    style TYPE fill:#fbbf24,stroke:#92400e
```

---

## 5. Sync-All (sincronización masiva)

```
POST /datasets/sync-all
```

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as Backend
    participant RL as syncRateLimit
    participant DB_EXT as BD(s) Externas
    participant PG as PostgreSQL

    FE->>BE: POST /datasets/sync-all
    BE->>RL: Check rate limit + storage
    RL-->>BE: OK

    BE->>PG: findMany WHERE sourceType IN ['api','db']

    loop Cada dataset (secuencial)
        BE->>DB_EXT: queryDB(config)
        DB_EXT-->>BE: rows[]
        BE->>BE: hashRows() → ¿cambió?
        alt Cambió
            BE->>PG: Persist rows (upsert o replace)
        end
    end

    BE-->>FE: { total, synced, unchanged, errors, details[] }
```

**Archivo:** `apps/backend/src/routes/datasets.js:134`

Sync-all es **secuencial** (no paralelo) — un dataset a la vez. Rate limit se aplica una sola vez al inicio.

---

## 6. Actualización del conector

```
PUT /datasets/:id/db-connector
```

```mermaid
flowchart TB
    REQ["PUT request<br/>{ name?, dbType?, connectionString?, query? }"]

    REQ --> CHECK_WRITE["canWriteDataset()?<br/>uploadedBy / org_admin / superadmin"]
    CHECK_WRITE --> MERGE["Merge campos nuevos con existentes"]

    MERGE --> CS_CHECK{"connectionString<br/>cambió?"}
    CS_CHECK -->|Sí| RE_ENC["encrypt({ connectionString })<br/>nuevo _enc"]
    CS_CHECK -->|No| KEEP["Mantener _enc existente"]

    RE_ENC --> SAVE["Dataset.update(config)"]
    KEEP --> SAVE
    SAVE --> RESP["Response (sin _enc)"]

    style CS_CHECK fill:#818cf8,stroke:#3730a3,color:#fff
```

**Archivo:** `apps/backend/src/routes/datasets.js:378`

Si solo cambia la query, la connectionString cifrada se preserva intacta.

---

## 7. Manejo de errores en sync

```mermaid
flowchart TB
    SYNC["performSync()"] --> TRY{"queryDB() / fetchAPI()"}

    TRY -->|Success| HASH["hashRows() → persist"]
    TRY -->|Error| CLASSIFY{"Tipo de error"}

    CLASSIFY -->|connection_error| CE["Host unreachable,<br/>auth failed, timeout"]
    CLASSIFY -->|ssl_error| SE["Certificado inválido"]
    CLASSIFY -->|http_error| HE["API status != 2xx"]
    CLASSIFY -->|parse_error| PE["Response no es JSON"]

    CE --> SAVE_ERR["Dataset.config.lastSyncStatus = errorType<br/>Dataset.config.lastSyncError = message"]
    SE --> SAVE_ERR
    HE --> SAVE_ERR
    PE --> SAVE_ERR

    SAVE_ERR --> RESP_ERR["502 { error, errorType }"]

    style CLASSIFY fill:#fbbf24,stroke:#92400e
```

**Archivo:** `apps/backend/src/routes/datasets.js:526-540`

Errores se persisten en `config.lastSyncStatus` y `config.lastSyncError` para mostrar estado en el frontend incluso tras refrescar.

---

## 8. Tracking de Storage

```mermaid
flowchart LR
    SYNC["Sync (insert/update/delete rows)"] --> DELTA["Calcular delta bytes<br/>Buffer.byteLength(JSON.stringify(rowData))"]
    DELTA --> UPDATE["Organization.storageUsedMB<br/>+= deltaBytes / 1024²"]
    UPDATE --> CHECK{"storageUsedMB >=<br/>plan.storageLimitMB?"}
    CHECK -->|Sí| BLOCK["429 STORAGE_LIMIT<br/>Próximos syncs bloqueados"]
    CHECK -->|No| OK["Sync permitido"]

    style CHECK fill:#ef4444,stroke:#991b1b,color:#fff
```

**Archivos:**
- `apps/backend/src/routes/datasets.js:44-56` — `rowBytes()`, `updateOrgStorage()`
- `apps/backend/src/middleware/syncRateLimit.js:33` — storage check

Storage se calcula por org, no por dataset. Cada sync ajusta el delta (positivo o negativo).

---

## 9. Resumen: Dónde vive cada cosa

| Dato | Dónde | Formato |
|------|-------|---------|
| Connection string | `Dataset.config._enc` | AES-256-GCM cifrado |
| Tipo de BD + query | `Dataset.config` (público) | JSON plano |
| Hash de último sync | `Dataset.config.dataHash` | 16-char hex (SHA-256 truncado) |
| Estado de sync | `Dataset.config.lastSyncStatus` | `'ok'` / `'connection_error'` / etc. |
| Campo de deduplicación | `Dataset.config.idField` | string / null / absent |
| Datos reales | `DatasetRow.rowData` | JSON plano (un row por registro) |
| Orden de filas | `DatasetRow.rowIndex` | int (0-based) |
| Consumo acumulado | `Organization.storageUsedMB` | float |
| Cache en browser | `CACHE[datasetId]` | Array in-memory (no persistido) |

---

## 10. Optimizaciones de rendimiento

### v0.4.0

| Optimización | Ubicación | Impacto |
|-------------|-----------|---------|
| **Virtualización de tabla** | `TableWidget.jsx` — `@tanstack/react-virtual` | Renderiza solo ~30 filas visibles, soporta cientos de miles sin degradar DOM |
| **Batch createMany** | `datasets.js` — `batchCreateRows()` | Inserta en lotes de 5,000 filas; evita statements SQL masivos en upload y sync |
| **Hash streaming** | `datasets.js` — `hashRows()` | `hash.update()` incremental por row; memoria O(1) en vez de O(n) |
| **Paginación server-side** | `GET /datasets/:id/rows?page=&pageSize=` | Carga parcial de rows con `skip`/`take`; max 50,000 por página |

### v0.5.0

| Optimización | Ubicación | Impacto |
|-------------|-----------|---------|
| **Agregación server-side** | `analyticsEngine.js` + `GET /aggregate` | KPI no necesita cargar todos los rows al browser; cache en memoria con TTL 5 min |
| **Bulk upsert** | `datasets.js` — `performSync()` | UPDATEs en lotes de 500 via `$transaction` en vez de 1 query secuencial por fila |
| **Connection pooling** | `dataParser.js` — pool manager | Reutiliza conexiones PG/MySQL/MSSQL (pool de 3, TTL 10 min); elimina handshake por sync |
