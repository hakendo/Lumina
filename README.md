# Lúmina

Plataforma de business intelligence web, multi-usuario, inspirada en Power BI. Permite cargar datos desde múltiples fuentes, construir reportes interactivos con widgets de arrastrar y soltar, y compartirlos pública o privadamente.

---

## Índice

- [¿Qué es Lúmina?](#qué-es-lúmina)
- [Funcionalidades](#funcionalidades)
- [Arquitectura y stack](#arquitectura-y-stack)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Variables de entorno](#variables-de-entorno)
- [Desarrollo local](#desarrollo-local)
- [Deploy en producción](#deploy-en-producción)
  - [Opción A — Railway (recomendado)](#opción-a--railway-recomendado)
  - [Opción B — VPS / servidor propio (Ubuntu)](#opción-b--vps--servidor-propio-ubuntu)
  - [Opción C — Docker Compose](#opción-c--docker-compose)
  - [Opción D — Windows Server (IIS + NSSM)](#opción-d--windows-server-iis--nssm)
- [API — Referencia rápida](#api--referencia-rápida)

---

## ¿Qué es Lúmina?

Lúmina es una aplicación web full-stack que permite a equipos analizar datos sin necesidad de herramientas de terceros costosas. Desde una interfaz visual de arrastrar y soltar, los usuarios pueden:

- Conectar sus propias fuentes de datos (archivos, APIs, bases de datos).
- Construir dashboards con múltiples tipos de visualización.
- Filtrar datos en tiempo real sin modificar la fuente.
- Exportar reportes a PDF con un click.
- Compartir reportes públicamente mediante un link único.

---

## Funcionalidades

### Fuentes de datos
| Tipo | Descripción |
|------|-------------|
| CSV / Excel | Sube archivos `.csv`, `.xlsx`, `.xls`, `.ods` directamente |
| API externa | Conecta cualquier endpoint REST — método, headers y body configurables |
| Base de datos | Ejecuta queries SQL contra PostgreSQL o MySQL externos |

Las credenciales sensibles (API keys en headers, connection strings de DB) se almacenan **cifradas con AES-256-GCM**. Nunca se devuelven al cliente en texto plano.

### Widgets disponibles
| Widget | Descripción |
|--------|-------------|
| **Gráfico** | Bar, line, area, pie, scatter (con tamaño de burbuja y etiquetas) |
| **KPI** | Tarjeta de métrica con agregación sum/avg/count/max/min, prefijo, sufijo y color |
| **Tabla** | Tabla scrolleable con columnas seleccionables |
| **Pivot** | Tabla cruzada con filas, columnas, valores y totales automáticos |
| **Mapa** | Puntos geográficos sobre OpenStreetMap vía Leaflet |

### Report builder
- Canvas de arrastrar y soltar con redimensionado libre (react-grid-layout).
- Panel de configuración lateral por widget (dataset, campos, tipo).
- **Filtros globales por reporte:** select, rango numérico y rango de fechas — se aplican a todos los widgets del mismo dataset en tiempo real.
- Auto-guardado del layout y los filtros con el reporte.

### Compartir y colaborar
- Reportes **privados** (solo el dueño) o **públicos** (link único `/public/:slug`).
- **Favoritos**: marca reportes públicos de otros usuarios con ★.
- **Duplicar**: copia un reporte completo (widgets + config) a tu workspace.
- **Explorar**: navega y busca todos los reportes públicos de la plataforma.
- **Export PDF**: generado en el servidor con Puppeteer (A4 landscape).

---

## Arquitectura y stack

```
┌─────────────────────┐        ┌────────────────────────┐
│   Frontend          │  HTTP  │   Backend              │
│   React 19 + Vite   │◄──────►│   Node.js + Express 5  │
│   Tailwind CSS v4   │        │   Prisma 5 ORM         │
│   Zustand           │        │   JWT + bcrypt         │
│   ECharts           │        │   AES-256-GCM (crypto) │
│   Leaflet           │        │   Puppeteer (PDF)      │
│   react-grid-layout │        └───────────┬────────────┘
└─────────────────────┘                    │
                                           │
                               ┌───────────▼────────────┐
                               │   PostgreSQL 16         │
                               │   (datos + reportes +  │
                               │    credenciales cifr.) │
                               └────────────────────────┘
```

**Frontend** corre en el puerto `5173` (dev) o como archivos estáticos servidos por nginx/CDN (prod).  
**Backend** corre en el puerto `3001`.

---

## Estructura del proyecto

```
lumina/
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   └── schema.prisma        # modelos de DB
│   │   ├── src/
│   │   │   ├── index.js             # entrada Express
│   │   │   ├── middleware/auth.js   # validación JWT
│   │   │   ├── routes/
│   │   │   │   ├── auth.js          # register / login / me
│   │   │   │   ├── datasets.js      # fuentes de datos + upload
│   │   │   │   └── reports.js       # reportes + share + PDF
│   │   │   └── services/
│   │   │       ├── dataParser.js    # CSV, Excel, API, DB
│   │   │       ├── encryption.js    # AES-256-GCM
│   │   │       └── pdfExport.js     # Puppeteer
│   │   └── uploads/                 # archivos subidos (local)
│   └── frontend/
│       └── src/
│           ├── pages/               # Login, Dashboard, ReportBuilder...
│           ├── components/
│           │   ├── Canvas/          # FilterBar, WidgetRenderer, ConfigPanel
│           │   └── widgets/         # Chart, KPI, Table, Pivot, Map
│           ├── store/               # authStore, reportStore (Zustand)
│           └── lib/api.js           # cliente Axios con interceptores JWT
└── package.json                     # workspaces raíz
```

---

## Variables de entorno

Crea el archivo `apps/backend/.env` (no se commitea):

```env
# Base de datos
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/lumina"

# Autenticación JWT — cámbialo en producción
JWT_SECRET="un_string_largo_y_aleatorio"

# Cifrado de credenciales — genera uno con el comando de abajo
ENCRYPTION_KEY="64_caracteres_hexadecimales"

# Servidor
PORT=3001

# Directorio para archivos subidos
UPLOAD_DIR="./uploads"

# URL del frontend (para PDF export con Puppeteer)
FRONTEND_URL="https://tu-dominio.com"
```

**Generar claves seguras:**
```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ENCRYPTION_KEY (debe ser exactamente 64 chars hex = 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Importante:** si pierdes `ENCRYPTION_KEY`, los datasets con conectores API/DB quedarán inutilizables porque no se podrán descifrar sus credenciales. Guárdala en un gestor de secretos.

---

## Desarrollo local

### Requisitos
- Node.js 18 o superior
- PostgreSQL 14 o superior

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/hakendo/Lumina.git
cd Lumina

# 2. Instalar todas las dependencias (frontend + backend juntos)
npm install

# 3. Crear la base de datos
psql -U postgres -c "CREATE DATABASE lumina;"

# 4. Configurar variables de entorno
cp apps/backend/.env.example apps/backend/.env
# Editar apps/backend/.env con tus valores

# 5. Aplicar migraciones
cd apps/backend
npx prisma migrate deploy
cd ../..

# 6. Levantar todo
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Health check: http://localhost:3001/health

---

## Deploy en producción

### Opción A — Railway (recomendado)

Railway permite deployar backend y base de datos sin configurar servidores.

#### 1. Base de datos

1. Crea un proyecto en [railway.app](https://railway.app).
2. Agrega un plugin **PostgreSQL**.
3. Copia la variable `DATABASE_URL` que Railway genera automáticamente.

#### 2. Backend

1. En el mismo proyecto, crea un nuevo servicio desde el repositorio de GitHub.
2. Configura el **Root Directory** como `apps/backend`.
3. Configura el **Start Command**:
   ```bash
   npx prisma migrate deploy && node src/index.js
   ```
4. Agrega las variables de entorno en Railway:
   ```
   DATABASE_URL        → (la del plugin PostgreSQL)
   JWT_SECRET          → (genera uno seguro)
   ENCRYPTION_KEY      → (genera uno seguro — guárdalo)
   PORT                → 3001
   UPLOAD_DIR          → ./uploads
   FRONTEND_URL        → https://tu-frontend.vercel.app
   ```
5. Deploy. Railway asignará una URL pública como `https://lumina-backend.railway.app`.

#### 3. Frontend

1. Importa el repositorio en [vercel.com](https://vercel.com) (o Netlify).
2. Configura:
   - **Root Directory:** `apps/frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Agrega la variable de entorno:
   ```
   VITE_API_URL=https://lumina-backend.railway.app
   ```
4. Actualiza `apps/frontend/src/lib/api.js` para usar `import.meta.env.VITE_API_URL` como `baseURL`.
5. Actualiza `FRONTEND_URL` en el backend con la URL de Vercel.

---

### Opción B — VPS / servidor propio (Ubuntu)

#### 1. Preparar el servidor

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Instalar nginx
sudo apt install -y nginx

# Instalar PM2 (process manager)
sudo npm install -g pm2
```

#### 2. Base de datos

```bash
sudo -u postgres psql

-- Dentro de psql:
CREATE USER lumina_user WITH PASSWORD 'password_seguro';
CREATE DATABASE lumina OWNER lumina_user;
GRANT ALL PRIVILEGES ON DATABASE lumina TO lumina_user;
\q
```

#### 3. Clonar y configurar la app

```bash
cd /var/www
sudo git clone https://github.com/hakendo/Lumina.git lumina
sudo chown -R $USER:$USER /var/www/lumina
cd /var/www/lumina

# Instalar dependencias
npm install

# Configurar variables de entorno
cp apps/backend/.env.example apps/backend/.env
nano apps/backend/.env
# Completar DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, FRONTEND_URL

# Migrar base de datos
cd apps/backend && npx prisma migrate deploy && cd ../..

# Compilar frontend
cd apps/frontend && npm run build && cd ../..
```

#### 4. Levantar el backend con PM2

```bash
# Crear archivo de configuración PM2
cat > /var/www/lumina/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'lumina-backend',
    script: 'src/index.js',
    cwd: '/var/www/lumina/apps/backend',
    env: {
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
  }]
}
EOF

pm2 start /var/www/lumina/ecosystem.config.js
pm2 save
pm2 startup  # seguir las instrucciones que imprime
```

#### 5. Configurar nginx

```bash
sudo nano /etc/nginx/sites-available/lumina
```

Pegar la siguiente configuración (reemplaza `tu-dominio.com`):

```nginx
server {
    listen 80;
    server_name tu-dominio.com www.tu-dominio.com;

    # Frontend — archivos estáticos
    location / {
        root /var/www/lumina/apps/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend — proxy inverso
    location /auth/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location /datasets/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 55M;
    }
    location /reports/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /health {
        proxy_pass http://localhost:3001;
    }

    # Archivos subidos
    location /uploads/ {
        alias /var/www/lumina/apps/backend/uploads/;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/lumina /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6. SSL con Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
# Certbot reconfigura nginx automáticamente con HTTPS
```

---

### Opción C — Docker Compose

Crea `docker-compose.yml` en la raíz del proyecto:

```yaml
version: '3.9'

services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: lumina
      POSTGRES_USER: lumina_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lumina_user -d lumina"]
      interval: 10s
      retries: 5

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    restart: always
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://lumina_user:${DB_PASSWORD}@db:5432/lumina
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      PORT: 3001
      UPLOAD_DIR: /app/uploads
      FRONTEND_URL: ${FRONTEND_URL}
    volumes:
      - uploads:/app/uploads
    ports:
      - "3001:3001"

  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile
      args:
        VITE_API_URL: ${VITE_API_URL}
    restart: always
    ports:
      - "80:80"
      - "443:443"

volumes:
  pgdata:
  uploads:
```

**`apps/backend/Dockerfile`:**
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
RUN npx prisma generate
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
```

**`apps/frontend/Dockerfile`:**
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**`apps/frontend/nginx.conf`:**
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**`.env` en la raíz para Docker:**
```env
DB_PASSWORD=password_seguro
JWT_SECRET=tu_jwt_secret
ENCRYPTION_KEY=tu_encryption_key_64_chars
FRONTEND_URL=https://tu-dominio.com
VITE_API_URL=https://tu-dominio.com
```

**Levantar:**
```bash
docker compose up -d
docker compose logs -f   # ver logs en tiempo real
```

---

### Opción D — Windows Server (IIS + NSSM)

Pasos para desplegar en Windows Server 2019 / 2022 usando IIS como proxy inverso y NSSM para mantener el backend corriendo como servicio de Windows.

#### 1. Instalar prerrequisitos

Abre **PowerShell como Administrador** y ejecuta:

```powershell
# Instalar winget si no está disponible (viene con Windows Server 2022; en 2019 descargar manualmente)
# https://github.com/microsoft/winget-cli/releases

# Node.js 22 LTS
winget install OpenJS.NodeJS.LTS

# Git
winget install Git.Git

# PostgreSQL 16
winget install PostgreSQL.PostgreSQL

# NSSM (Non-Sucking Service Manager) — para correr Node como servicio de Windows
winget install NSSM.NSSM
```

> Cierra y vuelve a abrir PowerShell para que los comandos `node`, `npm` y `git` queden disponibles en el PATH.

#### 2. Configurar PostgreSQL

Abre **pgAdmin** (se instala con PostgreSQL) o conéctate desde psql:

```powershell
# Conéctate con el usuario postgres
psql -U postgres
```

```sql
CREATE USER lumina_user WITH PASSWORD 'password_seguro';
CREATE DATABASE lumina OWNER lumina_user;
GRANT ALL PRIVILEGES ON DATABASE lumina TO lumina_user;
\q
```

Verifica que PostgreSQL esté corriendo como servicio de Windows:

```powershell
Get-Service -Name "postgresql*"
# Si está detenido:
Start-Service -Name "postgresql-x64-16"
```

#### 3. Clonar y configurar la aplicación

```powershell
# Elegir directorio de instalación
cd C:\inetpub

git clone https://github.com/hakendo/Lumina.git lumina
cd lumina

# Instalar dependencias
npm install

# Crear archivo de entorno del backend
Copy-Item apps\backend\.env.example apps\backend\.env
notepad apps\backend\.env
```

Edita `apps\backend\.env` con los valores reales:

```env
DATABASE_URL="postgresql://lumina_user:password_seguro@localhost:5432/lumina"
JWT_SECRET="un_string_largo_y_aleatorio"
ENCRYPTION_KEY="64_caracteres_hexadecimales"
PORT=3001
UPLOAD_DIR="C:\\inetpub\\lumina\\apps\\backend\\uploads"
FRONTEND_URL="https://tu-dominio.com"
```

```powershell
# Aplicar migraciones
cd apps\backend
npx prisma migrate deploy
cd ..\..

# Compilar frontend
cd apps\frontend
npm run build
cd ..\..
```

#### 4. Registrar el backend como servicio de Windows con NSSM

```powershell
# Registrar el servicio
nssm install lumina-backend "C:\Program Files\nodejs\node.exe"
nssm set lumina-backend AppDirectory "C:\inetpub\lumina\apps\backend"
nssm set lumina-backend AppParameters "src\index.js"
nssm set lumina-backend AppEnvironmentExtra "NODE_ENV=production"
nssm set lumina-backend DisplayName "Lumina Backend"
nssm set lumina-backend Description "Lumina BI – API Node.js"
nssm set lumina-backend Start SERVICE_AUTO_START

# Iniciar el servicio
nssm start lumina-backend

# Verificar estado
nssm status lumina-backend
```

Desde ahora el backend arranca automáticamente con Windows. Para ver logs:

```powershell
# NSSM guarda stdout/stderr si se configura:
nssm set lumina-backend AppStdout "C:\inetpub\lumina\logs\backend.log"
nssm set lumina-backend AppStderr "C:\inetpub\lumina\logs\backend-error.log"
nssm set lumina-backend AppRotateFiles 1
```

#### 5. Instalar y configurar IIS como proxy inverso

**5.1 Habilitar IIS y los módulos necesarios:**

```powershell
# Instalar IIS con los módulos requeridos
Install-WindowsFeature -Name Web-Server, Web-Asp-Net45, Web-Static-Content, Web-Http-Redirect -IncludeManagementTools

# Instalar URL Rewrite Module (necesario para proxy inverso)
# Descargar desde: https://www.iis.net/downloads/microsoft/url-rewrite
# O via winget:
winget install Microsoft.IISUrlRewrite

# Instalar Application Request Routing (ARR — proxy inverso)
# Descargar desde: https://www.iis.net/downloads/microsoft/application-request-routing
# O via winget:
winget install Microsoft.ApplicationRequestRouting
```

**5.2 Habilitar el proxy en ARR:**

```powershell
# Habilitar proxy en ARR via PowerShell con el módulo WebAdministration
Import-Module WebAdministration
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
  -filter "system.webServer/proxy" -name "enabled" -value "True"
```

**5.3 Crear el sitio en IIS:**

En el **Administrador de IIS** (o via PowerShell):

```powershell
Import-Module WebAdministration

# Crear grupo de aplicaciones
New-WebAppPool -Name "lumina"
Set-ItemProperty "IIS:\AppPools\lumina" -Name processModel.identityType -Value "ApplicationPoolIdentity"

# Crear sitio apuntando al frontend compilado
New-Website -Name "lumina" `
  -PhysicalPath "C:\inetpub\lumina\apps\frontend\dist" `
  -ApplicationPool "lumina" `
  -Port 80 `
  -HostHeader "tu-dominio.com"
```

**5.4 Agregar `web.config` al frontend compilado** para SPA routing y proxy al backend:

Crea el archivo `C:\inetpub\lumina\apps\frontend\dist\web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>

    <!-- Proxy inverso al backend para rutas de API -->
    <rewrite>
      <rules>
        <rule name="API Auth" stopProcessing="true">
          <match url="^auth/(.*)" />
          <action type="Rewrite" url="http://localhost:3001/auth/{R:1}" />
        </rule>
        <rule name="API Datasets" stopProcessing="true">
          <match url="^datasets/(.*)" />
          <action type="Rewrite" url="http://localhost:3001/datasets/{R:1}" />
        </rule>
        <rule name="API Reports" stopProcessing="true">
          <match url="^reports/(.*)" />
          <action type="Rewrite" url="http://localhost:3001/reports/{R:1}" />
        </rule>
        <rule name="Health" stopProcessing="true">
          <match url="^health$" />
          <action type="Rewrite" url="http://localhost:3001/health" />
        </rule>
        <!-- SPA fallback — siempre devolver index.html -->
        <rule name="SPA Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>

    <!-- Cabecera de tamaño máximo para subida de archivos (50 MB) -->
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="52428800" />
      </requestFiltering>
    </security>

    <staticContent>
      <mimeMap fileExtension=".webmanifest" mimeType="application/manifest+json" />
    </staticContent>

  </system.webServer>
</configuration>
```

#### 6. SSL con win-acme (Let's Encrypt)

```powershell
# Descargar win-acme desde https://www.win-acme.com/
# Extraer en C:\win-acme y ejecutar:
cd C:\win-acme
.\wacs.exe

# Seguir el asistente:
# - Seleccionar "Create new certificate"
# - Elegir el sitio IIS "lumina"
# - Confirmar el dominio tu-dominio.com
# win-acme instala el certificado y configura la renovación automática como tarea de Windows
```

> win-acme crea una **Tarea Programada de Windows** que renueva el certificado automáticamente antes de que expire.

#### 7. Firewall de Windows

```powershell
# Permitir tráfico HTTP y HTTPS
New-NetFirewallRule -DisplayName "HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# El puerto 3001 del backend NO debe exponerse al exterior (IIS hace el proxy)
```

#### 8. Comandos de mantenimiento útiles

```powershell
# Ver estado del servicio backend
nssm status lumina-backend

# Reiniciar el backend (p.ej. tras un deploy)
nssm restart lumina-backend

# Ver logs en tiempo real
Get-Content "C:\inetpub\lumina\logs\backend.log" -Wait -Tail 50

# Actualizar la aplicación
cd C:\inetpub\lumina
git pull origin main
npm install
cd apps\backend && npx prisma migrate deploy && cd ..\..
cd apps\frontend && npm run build && cd ..\..
nssm restart lumina-backend
# IIS sirve automáticamente el nuevo dist/ compilado
```

---

## API — Referencia rápida

Todas las rutas (excepto las públicas) requieren el header:
```
Authorization: Bearer <token>
```

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/register` | `{ email, password, name }` → `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | Perfil del usuario autenticado |

### Datasets
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/datasets` | Lista datasets del usuario |
| POST | `/datasets/upload` | Sube CSV/Excel (`multipart/form-data`) |
| POST | `/datasets/api-connector` | Crea conector API (credenciales cifradas) |
| PUT | `/datasets/:id/api-connector` | Edita conector API |
| POST | `/datasets/db-connector` | Crea conector DB (connection string cifrado) |
| PUT | `/datasets/:id/db-connector` | Edita conector DB |
| POST | `/datasets/:id/fetch` | Ejecuta y sincroniza datos (API o DB) |
| GET | `/datasets/:id/rows` | Devuelve todas las filas |
| GET | `/datasets/:id/columns` | Devuelve nombres de columnas |
| DELETE | `/datasets/:id` | Elimina dataset y sus filas |

### Reportes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/reports` | Lista reportes del usuario (con `isFavorited`) |
| POST | `/reports` | Crea reporte |
| GET | `/reports/explore` | Lista todos los reportes públicos (`?q=búsqueda`) |
| GET | `/reports/favorites` | Lista reportes marcados como favoritos |
| GET | `/reports/:id` | Obtiene reporte con widgets |
| PUT | `/reports/:id` | Guarda layout, filtros y widgets |
| DELETE | `/reports/:id` | Elimina reporte |
| POST | `/reports/:id/duplicate` | Clona reporte en el workspace propio |
| POST | `/reports/:id/share` | Toggle público/privado |
| POST | `/reports/:id/favorite` | Toggle favorito |
| GET | `/reports/:id/export/pdf` | Descarga PDF (Puppeteer, A4 landscape) |
| GET | `/reports/public/:slug` | Vista pública sin autenticación |
