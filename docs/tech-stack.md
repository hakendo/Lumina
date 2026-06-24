# Lúmina — Stack Tecnológico y Diagramas de Comunicación

## 1. Resumen del Stack

| Capa | Tecnología | Versión | Rol |
|------|-----------|---------|-----|
| **Monorepo** | pnpm workspaces | 11.x | Orquesta `apps/frontend` y `apps/backend` (`pnpm-workspace.yaml`) |
| **Dev runner** | concurrently | 9.x | Ejecuta backend + frontend en paralelo (`pnpm run dev`) |

### 1.1 Frontend (`apps/frontend/`)

| Tecnología | Versión | Rol |
|-----------|---------|-----|
| React | 19.x | UI library (lazy-loading por ruta) |
| React Router DOM | 7.x | Enrutamiento SPA (client-side) |
| Vite | 8.x | Bundler / dev server / HMR |
| Tailwind CSS | 4.x (v4, `@theme`) | Utility-first CSS con design tokens |
| Zustand | 5.x | Estado global (auth, report) |
| Axios | 1.x | Cliente HTTP con interceptores JWT |
| ECharts / echarts-for-react | 6.x / 3.x | Gráficos (bar, line, pie, scatter, etc.) |
| Leaflet / react-leaflet | 1.9 / 5.x | Mapas interactivos |
| react-grid-layout | 2.x | Grid drag-and-drop para widgets del canvas |
| @dnd-kit/core + sortable | 6.x / 10.x | Drag-and-drop genérico (ordenamiento) |
| @tanstack/react-virtual | 3.x | Virtualización de filas en TableWidget (render solo viewport) |
| nanoid | 5.x | Generación de IDs en cliente |
| ESLint | 10.x | Linting |

### 1.2 Backend (`apps/backend/`)

| Tecnología | Versión | Rol |
|-----------|---------|-----|
| Node.js + Express | 5.x | API REST |
| Prisma ORM | 5.x | ORM + migraciones |
| PostgreSQL | — | Base de datos principal |
| JSON Web Tokens (jsonwebtoken) | 9.x | Autenticación stateless |
| bcryptjs | 3.x | Hashing de contraseñas |
| Helmet | 8.x | Headers de seguridad HTTP |
| CORS | 2.x | Control de acceso cross-origin |
| Morgan | 1.x | Logging HTTP |
| Multer | 2.x | Upload de archivos (CSV, Excel) |
| csv-parse | 6.x | Parser de archivos CSV |
| exceljs + xlsx | 4.x / 0.18 | Parser de archivos Excel |
| Puppeteer | 25.x | Renderizado headless para export PDF |
| pdf-lib | 1.x | Merge de PDFs multi-página |
| otplib + qrcode | 12.x / 1.x | MFA (TOTP) con QR de setup |
| AES-256-GCM (crypto nativo) | — | Encriptación de credenciales de conectores |
| nanoid | 3.x | IDs y slugs únicos |

### 1.3 Conectores de Base de Datos (data sources externos)

| Driver | Base de datos destino |
|--------|----------------------|
| pg | PostgreSQL |
| mysql2 | MySQL / MariaDB |
| mssql | Microsoft SQL Server |
| oracledb | Oracle Database |
| ioredis | Redis |

### 1.4 Infraestructura / Dev Tools

| Herramienta | Rol |
|-------------|-----|
| pnpm | Package manager (workspaces) — reemplaza npm |
| nodemon | Hot-reload del backend en desarrollo |
| Vite dev server + proxy | Proxy reverso a Express (`:3001`) en desarrollo |
| Prisma CLI | Migraciones (`db:migrate`), generación de client (`prisma generate`) |
| ngrok (opcional) | Túnel público para testing externo |

---

## 2. Arquitectura de Alto Nivel

```mermaid
graph TB
    subgraph Cliente["🖥️ Cliente (Browser)"]
        subgraph SPA["React 19 SPA (Vite 8)"]
            Zustand["Zustand Stores<br/>(auth, report)"]
            Axios["Axios<br/>(JWT interceptors)"]
            Router["React Router DOM 7<br/>(lazy routes)"]
            ECharts["ECharts 6<br/>(gráficos)"]
            Leaflet["Leaflet<br/>(mapas)"]
            GridLayout["react-grid-layout<br/>(canvas drag/resize)"]
            Virtual["@tanstack/react-virtual<br/>(table virtualization)"]
        end
    end

    subgraph Proxy["Vite Dev Proxy (:5173)"]
        ProxyLogic["Accept: json → :3001<br/>Accept: html → SPA"]
    end

    subgraph Servidor["🖧 Servidor"]
        subgraph Express["Express 5 (:3001)"]
            subgraph Middleware["Middleware"]
                Helmet["Helmet"]
                CORS["CORS"]
                Morgan["Morgan"]
                JSONParser["express.json<br/>(10mb)"]
            end

            subgraph AuthMW["Auth Middleware"]
                JWTAuth["auth.js<br/>(JWT verify)"]
                OrgAdmin["orgAdmin.js"]
                SuperAdmin["superAdmin.js"]
                RateLimit["syncRateLimit.js"]
            end

            subgraph Routes["Routes"]
                RAuth["/auth"]
                RAdmin["/admin"]
                ROrg["/org"]
                RAreas["/areas"]
                RDatasets["/datasets"]
                RReports["/reports"]
                RNotif["/notifications"]
            end

            subgraph Services["Services"]
                DataParser["dataParser.js<br/>(connection pooling)"]
                Analytics["analyticsEngine.js<br/>(server-side aggregation)"]
                Encryption["encryption.js<br/>(AES-256-GCM)"]
                ExprEval["exprEval.js"]
                PDFExport["pdfExport.js"]
            end

            Prisma["Prisma ORM 5"]
        end
    end

    PostgreSQL[("PostgreSQL<br/>Base de datos")]

    Axios -->|"HTTP/JSON"| ProxyLogic
    ProxyLogic -->|"API requests"| Helmet
    Helmet --> CORS --> Morgan --> JSONParser
    JSONParser --> Routes
    Routes --> AuthMW
    AuthMW --> Services
    Services --> Prisma
    Prisma --> PostgreSQL

    style Cliente fill:#fef3c7,stroke:#d97706
    style Servidor fill:#e0e7ff,stroke:#4f46e5
    style PostgreSQL fill:#d1fae5,stroke:#059669
```

---

## 3. Flujo de Autenticación

```mermaid
sequenceDiagram
    participant B as Browser (React)
    participant E as Express /auth
    participant DB as PostgreSQL

    B->>E: POST /auth/login<br/>{email, password}
    E->>DB: SELECT User WHERE email
    DB-->>E: User record
    E->>E: bcrypt.compare(password, hash)

    alt MFA no habilitado
        E-->>B: 200 {token, user}
        B->>B: localStorage.setItem('token', jwt)
    else MFA habilitado
        E-->>B: 200 {mfaRequired: true, tempToken}
        B->>E: POST /auth/mfa/verify<br/>{code}<br/>Authorization: Bearer tempToken
        E->>E: otplib.verify(code, mfaSecret)
        E-->>B: 200 {token (definitivo)}
        B->>B: localStorage.setItem('token', jwt)
    end

    Note over B,E: Todas las llamadas posteriores

    B->>E: GET /any-route<br/>Authorization: Bearer jwt
    E->>E: middleware/auth.js<br/>jwt.verify() → req.user
    E-->>B: 200 response
```

---

## 4. Flujo de Datos (Datasets)

```mermaid
flowchart TB
    subgraph Sources["Fuentes de Datos"]
        CSV["📄 CSV"]
        Excel["📊 Excel"]
        API["🌐 API Externa"]
        DBExt["🗄️ Base de Datos Externa"]
    end

    subgraph Backend["Express /datasets"]
        Multer["Multer<br/>(file upload)"]

        subgraph Parser["dataParser.js"]
            CSVParse["csv-parse"]
            ExcelJS["exceljs / xlsx"]
            AxiosExt["axios<br/>(fetch externo)"]
            subgraph DBDrivers["DB Drivers"]
                PG["pg"]
                MySQL["mysql2"]
                MSSQL["mssql"]
                Oracle["oracledb"]
                Redis["ioredis"]
            end
        end

        subgraph Encrypt["encryption.js"]
            AES["AES-256-GCM<br/>IV(16B) + AuthTag"]
        end

        Prisma2["Prisma ORM"]
    end

    PGMain[("PostgreSQL<br/>Dataset + DatasetRow")]

    CSV --> Multer --> CSVParse
    Excel --> Multer --> ExcelJS
    API --> AxiosExt
    DBExt --> DBDrivers

    CSVParse --> Prisma2
    ExcelJS --> Prisma2
    AxiosExt --> Prisma2
    DBDrivers --> Prisma2
    Prisma2 --> PGMain

    DBExt -.->|"credenciales cifradas"| AES
    API -.->|"headers cifrados"| AES
    AES -.->|"config JSON cifrado"| PGMain

    style Sources fill:#fef9c3,stroke:#ca8a04
    style Backend fill:#e0e7ff,stroke:#4f46e5
    style PGMain fill:#d1fae5,stroke:#059669
```

---

## 5. Flujo del Report Builder (Canvas)

```mermaid
flowchart TB
    subgraph RB["ReportBuilder.jsx"]
        FB["FilterBar.jsx<br/>(filtros globales por página)"]

        subgraph Canvas["react-grid-layout (canvas drag/resize)"]
            WR["WidgetRenderer.jsx<br/>(CACHE map por dataset)"]

            subgraph Widgets["Widget Types"]
                Chart["ChartWidget<br/>(ECharts)"]
                KPI["KPIWidget<br/>(cálculos)"]
                Table["TableWidget<br/>(@tanstack/react-virtual<br/>filas virtualizadas)"]
                Pivot["PivotWidget<br/>(pivot table)"]
                Map["MapWidget<br/>(Leaflet)"]
            end
        end

        WCP["WidgetConfigPanel.jsx<br/>(tipo, dataset, ejes, colores)"]

        subgraph Store["Zustand (reportStore)"]
            Dirty["isDirty tracking"]
            Save["Ctrl+S save"]
            Guard["beforeunload guard"]
        end
    end

    API_DS["/datasets/:id/rows"]

    FB -->|"applyFilters()"| WR
    WR -->|"GET"| API_DS
    API_DS -->|"rows[]"| WR
    WR --> Chart & KPI & Table & Pivot & Map
    WCP -->|"config changes"| Store
    Store -->|"re-render"| WR

    style RB fill:#fef3c7,stroke:#d97706
    style Canvas fill:#e0e7ff,stroke:#4f46e5
    style Store fill:#fce7f3,stroke:#db2777
```

---

## 6. Export PDF

```mermaid
sequenceDiagram
    participant B as Browser
    participant E as Express
    participant P as Puppeteer (Chromium)
    participant SPA as React SPA
    participant PDF as pdf-lib

    B->>E: POST /reports/:id/export-pdf
    E->>E: Genera JWT efímero<br/>(en memoria, no localStorage)

    E->>P: Lanza headless Chromium
    P->>SPA: GET /report/:id/view?token=xxx

    loop Cada página del reporte
        SPA-->>P: Renderiza widgets
        P->>P: page.pdf() → PDF buffer
    end

    P-->>E: PDF buffers[]
    E->>PDF: Merge multi-página
    PDF-->>E: PDF final
    E-->>B: 200 (PDF binary)
```

---

## 7. Modelo de Datos (Entidad-Relación)

```mermaid
erDiagram
    Plan ||--o{ Organization : "1:N"
    Organization ||--o{ OrgMembership : "1:N"
    Organization ||--o{ Area : "1:N"
    Organization ||--o{ OrgAuditLog : "1:N"

    User ||--o{ OrgMembership : "1:N"
    User ||--o{ AreaMember : "1:N"
    User ||--o{ Dataset : "uploads"
    User ||--o{ Report : "owns"
    User ||--o{ UserFavorite : "1:N"
    User ||--o{ ReportShare : "shared with"
    User ||--o{ Notification : "1:N"
    User ||--o{ OrgAuditLog : "admin action"

    Area ||--o{ AreaMember : "1:N"
    Area ||--o| AreaPolicy : "0..1"
    Area ||--o{ Dataset : "1:N"
    Area ||--o{ Report : "1:N"

    Dataset ||--o{ DatasetRow : "1:N"
    Dataset ||--o{ ReportWidget : "bound to"
    Dataset ||--o{ DatasetSlotBinding : "slot"

    Report ||--o{ ReportPage : "1:N"
    Report ||--o{ ReportWidget : "1:N"
    Report ||--o{ UserFavorite : "1:N"
    Report ||--o{ ReportShare : "1:N"
    Report ||--o{ DatasetSlotBinding : "1:N"
    Report ||--o{ Report : "template → derived"

    ReportPage ||--o{ ReportWidget : "1:N"

    Plan {
        string id PK
        string name UK
        int retentionDays
        int maxUsers
        float storageLimitMB
        boolean allowPublicLinks
        boolean allowExternalShare
        json syncRateLimit
    }

    Organization {
        string id PK
        string name
        string slug UK
        boolean isActive
        string planId FK
        float storageUsedMB
        boolean policyAllowPublicLink
        boolean policyAllowExternalShare
        boolean policyAllowPublishToArea
        boolean policyAllowCreateReport
    }

    User {
        string id PK
        string email UK
        string passwordHash
        string name
        string role
        boolean isActive
        boolean mfaEnabled
        boolean mfaEnforced
        string mfaSecret
    }

    OrgMembership {
        string id PK
        string userId FK
        string orgId FK
        string role
    }

    Area {
        string id PK
        string orgId FK
        string name
    }

    AreaMember {
        string id PK
        string areaId FK
        string userId FK
    }

    AreaPolicy {
        string id PK
        string areaId FK
        boolean allowPublicLink
        boolean allowExternalShare
        boolean allowPublishToArea
        boolean allowCreateReport
    }

    Dataset {
        string id PK
        string areaId FK
        string uploadedById FK
        string name
        string sourceType
        json config
        string filePath
        string slotName
        datetime deletedAt
    }

    DatasetRow {
        string id PK
        string datasetId FK
        json rowData
        int rowIndex
    }

    Report {
        string id PK
        string ownerId FK
        string areaId FK
        string title
        string description
        boolean isPublic
        boolean isTemplate
        string templateId FK
        string slug UK
        datetime deletedAt
    }

    ReportPage {
        string id PK
        string reportId FK
        string title
        int order
        json layout
        json filters
    }

    ReportWidget {
        string id PK
        string reportId FK
        string pageId FK
        string datasetId FK
        string widgetType
        json config
        json position
    }

    ReportShare {
        string id PK
        string reportId FK
        string userId FK
        string role
    }

    DatasetSlotBinding {
        string id PK
        string reportId FK
        string slotName
        string clientDatasetId FK
    }

    UserFavorite {
        string id PK
        string userId FK
        string reportId FK
    }

    Notification {
        string id PK
        string userId FK
        string type
        json payload
        datetime readAt
    }

    OrgAuditLog {
        string id PK
        string orgId FK
        string adminId FK
        string action
        string oldValue
        string newValue
        string reason
    }
```

---

## 8. Rutas de la API

| Grupo | Endpoint destacados | Auth |
|-------|-------------------|------|
| `/auth` | `POST /login`, `POST /register`, `POST /mfa/setup`, `POST /mfa/verify`, `PUT /change-password` | Público (login/register), JWT (resto) |
| `/admin` | CRUD usuarios, orgs, planes, reportes de admin | JWT + superadmin |
| `/org` | CRUD org, membresías, planes, política | JWT + org_admin |
| `/areas` | CRUD áreas, miembros, políticas | JWT + org_admin |
| `/datasets` | Upload CSV/Excel, sync API/DB, CRUD, `/rows` (paginado), `/aggregate`, `/stats`, `/distinct`, `/file` | JWT |
| `/reports` | CRUD, favorites, share, export-pdf, publish slug | JWT (público para `/public/:slug`) |
| `/notifications` | GET (listar), PATCH (marcar leído) | JWT |
| `/health` | Healthcheck | Público |

---

## 9. Middleware Pipeline

```mermaid
flowchart LR
    Req(("Request")) --> Helmet["Helmet<br/>(security headers)"]
    Helmet --> CORS["CORS<br/>(whitelist)"]
    CORS --> Morgan["Morgan<br/>(logging)"]
    Morgan --> JSON["express.json<br/>(10mb limit)"]
    JSON --> RouterMatch{"Router<br/>matching"}

    RouterMatch -->|"/auth<br/>/datasets<br/>/reports<br/>/notifications"| AuthJWT["auth.js<br/>(JWT verify)"]
    RouterMatch -->|"/org<br/>/areas"| OrgAdminMW["auth.js → orgAdmin.js<br/>(org_admin check)"]
    RouterMatch -->|"/admin"| SuperMW["auth.js → superAdmin.js<br/>(superadmin check)"]

    AuthJWT --> Handler1["Route Handler"]
    OrgAdminMW --> RateLimit["syncRateLimit<br/>(dataset sync)"]
    RateLimit --> Handler2["Route Handler"]
    SuperMW --> Handler3["Route Handler"]

    style Req fill:#fbbf24,stroke:#92400e
    style RouterMatch fill:#818cf8,stroke:#3730a3,color:#fff
```

---

## 10. Frontend — Estructura de Rutas

| Ruta | Componente | Auth | Descripción |
|------|-----------|------|-------------|
| `/login` | Login | No | Login + registro |
| `/` | Dashboard | JWT | Home, reportes recientes, favoritos |
| `/report/:id` | ReportBuilder | JWT | Editor de reportes (canvas) |
| `/report/:id/view` | ReportView | Token URL | Vista read-only (usada por Puppeteer PDF) |
| `/public/:slug` | PublicReport | No | Reporte público compartido |
| `/datasets` | Datasets | JWT | Gestión de datasets |
| `/explore` | Explore | JWT | Exploración de datos |
| `/admin` | Admin | JWT + superadmin | Panel superadmin |
| `/org/admin` | OrgAdmin | JWT + org_admin | Panel admin de organización |
| `/profile` | Profile | JWT | Perfil de usuario, MFA, cambio de contraseña |
| `/changelog` | Changelog | JWT | Historial de versiones y mejoras |

---

## 11. Comunicación entre Componentes Frontend

```mermaid
flowchart TB
    subgraph App["App.jsx"]
        subgraph Stores["Zustand Stores"]
            AuthStore["authStore.js<br/>• token<br/>• user<br/>• loadUser() / login() / logout()"]
            ReportStore["reportStore.js<br/>• report / widgets / pages<br/>• isDirty<br/>• applyFilters()"]
        end

        subgraph APILayer["API Layer"]
            AxiosInst["api.js (Axios)<br/>• JWT inject interceptor<br/>• 401 → redirect /login"]
        end

        subgraph DesignSystem["Design System (ui.jsx)"]
            Components["Icon • Wordmark • Button<br/>Field • Modal • EmptyState<br/>SkeletonCards • AppHeader"]
        end

        RequireAuth["RequireAuth gate"]
    end

    subgraph Pages["Pages"]
        Dashboard2["Dashboard"]
        ReportBuilder2["ReportBuilder"]
        Datasets2["Datasets"]
        AdminPage["Admin / OrgAdmin"]
        ProfilePage["Profile"]
        ChangelogPage["Changelog"]
    end

    AuthStore -->|"token check"| RequireAuth
    RequireAuth -->|"gate"| Pages
    ReportStore -->|"state"| ReportBuilder2
    AxiosInst -->|"HTTP"| Pages
    Components -->|"primitives"| Pages

    ReportBuilder2 -->|"save/load"| AxiosInst
    Dashboard2 -->|"fetch"| AxiosInst
    Datasets2 -->|"upload/sync"| AxiosInst

    style App fill:#fef3c7,stroke:#d97706
    style Stores fill:#fce7f3,stroke:#db2777
    style Pages fill:#e0e7ff,stroke:#4f46e5
```

---

## 12. Seguridad

```mermaid
mindmap
  root((Seguridad<br/>Lúmina))
    Autenticación
      JWT stateless
      bcryptjs password hashing
      MFA TOTP con otplib
      QR code setup
      mfaEnforced flag
    Headers HTTP
      Helmet
        CSP
        HSTS
        X-Frame-Options
        X-Content-Type-Options
    Aislamiento
      CORS whitelist FRONTEND_URL
      Org isolation middleware
      Area policies heredadas
    Cifrado
      AES-256-GCM at-rest
        Credenciales DB
        Headers API
      IV 16B + AuthTag
      ENCRYPTION_KEY env
    Uploads
      NO static serving
      Ruta autenticada GET /datasets/:id/file
    Rate Limiting
      syncRateLimit por plan
      maxPerMinute / maxPerHour / maxPerDay
    PDF Export
      Token efímero en memoria
      No localStorage
      Puppeteer sandbox
```

---

## 13. Design Tokens (Tailwind v4)

```mermaid
graph LR
    subgraph Colors["Paleta de Colores"]
        BG["Backgrounds<br/>paper • paper-deep • surface"]
        Text["Texto<br/>ink • ink-soft • ink-faint"]
        Borders["Bordes<br/>line • line-soft"]
        Accent["Acento<br/>lumen-* (amber)"]
        Status["Status<br/>sea (success) • rust (danger)"]
    end

    subgraph Fonts["Tipografías"]
        Display["font-display<br/>Fraunces<br/>(headings/wordmark)"]
        Sans["font-sans<br/>Hanken Grotesk<br/>(body)"]
        Mono["font-mono<br/>Spline Sans Mono<br/>(datos/números)"]
    end

    subgraph Utils["Utilidades CSS"]
        PaperBG[".paper-bg<br/>(grain + glow)"]
        CanvasBG[".canvas-bg<br/>(dotted builder)"]
        Fields[".field • .field-sm<br/>.field-mono"]
        Skeleton[".skeleton<br/>(loading shimmer)"]
        Rise["animate-rise<br/>(entry animation)"]
    end

    style Colors fill:#fef3c7,stroke:#d97706
    style Fonts fill:#e0e7ff,stroke:#4f46e5
    style Utils fill:#d1fae5,stroke:#059669
```

---

## 14. Diagrama de Despliegue (Desarrollo)

```mermaid
graph TB
    subgraph DevMachine["🖥️ Developer Machine"]
        subgraph NPM["pnpm run dev (concurrently)"]
            Vite["Vite :5173<br/>HMR + Proxy → :3001"]
            ExpressDev["Express :3001<br/>nodemon hot-reload"]
            Vite -->|"API proxy<br/>(Accept: json)"| ExpressDev
        end

        ExpressDev --> PG[("PostgreSQL<br/>(DATABASE_URL)")]
        ExpressDev -.->|"on-demand<br/>PDF export"| Chromium["Chromium<br/>(Puppeteer headless)"]
        Chromium -.->|"GET /report/:id/view"| Vite
    end

    subgraph Optional["Opcional"]
        Ngrok["ngrok<br/>túnel público → :5173"]
    end

    Vite -.-> Ngrok
    Browser(("🌐 Browser")) --> Vite
    ExtBrowser(("🌐 Externo")) -.-> Ngrok

    style DevMachine fill:#f3f4f6,stroke:#374151
    style Optional fill:#fef9c3,stroke:#ca8a04
    style PG fill:#d1fae5,stroke:#059669
```

---

## 15. Flujo Completo: Request Lifecycle

```mermaid
sequenceDiagram
    participant U as Usuario
    participant V as Vite :5173
    participant E as Express :3001
    participant MW as Middleware Chain
    participant R as Route Handler
    participant S as Service Layer
    participant P as Prisma ORM
    participant DB as PostgreSQL

    U->>V: HTTP Request
    alt Accept: text/html
        V-->>U: SPA (index.html)
    else Accept: application/json
        V->>E: Proxy forward
        E->>MW: Helmet → CORS → Morgan → JSON parse
        MW->>MW: JWT verify → role check
        MW->>R: Route dispatch
        R->>S: Business logic
        S->>P: Query builder
        P->>DB: SQL query
        DB-->>P: Result rows
        P-->>S: Typed objects
        S-->>R: Processed data
        R-->>E: JSON response
        E-->>V: Proxy return
        V-->>U: JSON response
    end
```
