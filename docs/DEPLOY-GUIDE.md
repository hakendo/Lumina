# Guia de Deploy — Lumina BI Platform

Documento operativo para desplegar Lumina en Windows Server 2022.
Basado en experiencia real de deploy en servidor sin acceso a internet.

---

## Arquitectura del deploy

```
┌─────────────────────────────────────────────────────────┐
│                    Windows Server 2022                   │
│                                                         │
│  ┌─────────────┐        ┌──────────────────────────┐    │
│  │   IIS        │  proxy │  Node.js (NSSM service)  │    │
│  │  Puerto 80   │───────>│  Puerto 3001             │    │
│  │  /auth/*     │        │  apps/backend/src/        │    │
│  │  /reports/*  │        │                          │    │
│  │  /datasets/* │        │  Prisma ORM              │    │
│  │  /admin/*    │        │         │                │    │
│  │  /org/*      │        └─────────┼────────────────┘    │
│  │  /areas/*    │                  │                     │
│  │  /notif.*    │        ┌─────────▼────────────────┐    │
│  │              │        │  PostgreSQL 17            │    │
│  │  Estáticos:  │        │  Puerto 5432             │    │
│  │  dist/       │        │  DB: lumina              │    │
│  └─────────────┘        │  User: lumina_user       │    │
│                          └──────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

- **IIS** sirve archivos estáticos del frontend (dist/) y hace reverse proxy al backend via ARR
- **Node.js** corre el backend Express como servicio Windows via NSSM
- **PostgreSQL** almacena todos los datos
- **web.config** define las reglas de rewrite (API routes → backend, SPA fallback → index.html)

---

## Prerequisitos del servidor

| Componente | Version | Proposito |
|-----------|---------|-----------|
| Windows Server | 2022 | OS |
| Node.js | 22 LTS | Runtime backend |
| PostgreSQL | 17 | Base de datos |
| NSSM | 2.24 | Servicio Windows para Node |
| IIS | Built-in | Web server + reverse proxy |
| URL Rewrite | 2.1 | Modulo IIS para rewrite rules |
| ARR | 3.0 | Application Request Routing (proxy) |

---

## Paso 0: Generar release (maquina con internet)

Desde la raiz del repositorio en una maquina de desarrollo:

```powershell
.\scripts\make-release.ps1 -Version "2026-06-24"
```

Esto genera `lumina-release-2026-06-24.zip` que contiene:
- `installers/` — MSIs offline de Node, PostgreSQL, NSSM, URL Rewrite, ARR
- `app/` — codigo completo con node_modules y frontend compilado (dist/)
- `instalar.ps1` — script de instalacion automatica
- `INSTALACION.md` — guia resumida

Transferir el ZIP al servidor via USB, recurso de red, o similar.

---

## Paso 1: Instalacion automatica (recomendado)

```powershell
# En el servidor, PowerShell como Administrador
Set-ExecutionPolicy Bypass -Scope Process -Force
cd C:\ruta\al\release\extraido
.\instalar.ps1 -Port 8090
```

Parametros disponibles:

| Parametro | Default | Descripcion |
|-----------|---------|-------------|
| `-Domain` | (vacio) | Dominio del servidor. Si se omite, usa IP local |
| `-InstallPath` | `C:\inetpub\lumina` | Donde se instala la app |
| `-PgHost` | `localhost` | Host de PostgreSQL |
| `-PgPort` | `5432` | Puerto de PostgreSQL |
| `-Port` | `80` | Puerto HTTP de IIS |
| `-BackendPort` | `3001` | Puerto del backend Node.js |
| `-SkipPgInstall` | false | Usar si PostgreSQL ya esta instalado |

El script pide interactivamente:
- Contrasena del superusuario postgres (si instala PG, o del existente)
- Contrasena para `lumina_user`
- JWT_SECRET (string aleatorio, min 32 chars)
- ENCRYPTION_KEY (64 caracteres hexadecimales)

---

## Paso 2: Instalacion manual (paso a paso)

Usar solo si el script automatico falla o se necesita control fino.

### 2.1 Instalar software

```powershell
# Node.js
msiexec /i installers\node.msi /qn ADDLOCAL=ALL

# PostgreSQL (cambiar PASSWORD)
.\installers\postgresql.exe --unattendedmodeui none --mode unattended `
    --superpassword "PASSWORD" --servicename postgresql-x64-17

# NSSM
Copy-Item installers\nssm\nssm-2.24\win64\nssm.exe C:\Windows\System32\nssm.exe

# Reiniciar PowerShell para que PATH tome los cambios
```

### 2.2 Crear base de datos

```powershell
$env:PGPASSWORD = "postgres_password"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c `
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='lumina_user') THEN CREATE USER lumina_user WITH PASSWORD 'Stg2026!'; END IF; END $$;"

& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c `
    "CREATE DATABASE lumina OWNER lumina_user;"

& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c `
    "GRANT ALL PRIVILEGES ON DATABASE lumina TO lumina_user;"
```

### 2.3 Desplegar archivos

```powershell
# Copiar app
Copy-Item app\* C:\inetpub\lumina -Recurse -Force
New-Item -ItemType Directory -Force -Path C:\inetpub\lumina\logs
New-Item -ItemType Directory -Force -Path C:\inetpub\lumina\apps\backend\uploads
```

### 2.4 Configurar .env

Crear `C:\inetpub\lumina\apps\backend\.env`:

```env
DATABASE_URL="postgresql://lumina_user:Stg2026!@localhost:5432/lumina"
JWT_SECRET="string-aleatorio-minimo-32-caracteres"
ENCRYPTION_KEY="64-caracteres-hexadecimales"
PORT=3001
UPLOAD_DIR="C:\\inetpub\\lumina\\apps\\backend\\uploads"
FRONTEND_URL="http://192.168.180.80:8090"
NODE_ENV=production
```

> **IMPORTANTE**: El .env va en `apps\backend\.env`, NO en la raiz.
> El PORT del .env es el del backend (3001), NO el de IIS.

### 2.5 Migraciones Prisma

```powershell
cd C:\inetpub\lumina\apps\backend
node node_modules\prisma\build\index.js migrate deploy
```

Si falla por certificado SSL (entornos corporativos):
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node node_modules\prisma\build\index.js migrate deploy
$env:NODE_TLS_REJECT_UNAUTHORIZED = $null
```

> **NOTA**: Las migraciones se ejecutan con la conexion de `DATABASE_URL`.
> Si se usa el usuario `postgres` para migrar, hay que dar permisos a `lumina_user` despues:
> ```sql
> GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lumina_user;
> GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO lumina_user;
> ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO lumina_user;
> ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO lumina_user;
> ```

### 2.6 Registrar servicio Windows (NSSM)

```powershell
nssm install lumina-backend "C:\Program Files\nodejs\node.exe"
nssm set lumina-backend AppDirectory        "C:\inetpub\lumina\apps\backend"
nssm set lumina-backend AppParameters       "src\index.js"
nssm set lumina-backend AppEnvironmentExtra "NODE_ENV=production"
nssm set lumina-backend DisplayName         "Lumina Backend"
nssm set lumina-backend Description         "Lumina BI - API Node.js"
nssm set lumina-backend Start               SERVICE_AUTO_START
nssm set lumina-backend AppStdout           "C:\inetpub\lumina\logs\backend.log"
nssm set lumina-backend AppStderr           "C:\inetpub\lumina\logs\backend-error.log"
nssm set lumina-backend AppRotateFiles      1
nssm start lumina-backend
```

Verificar:
```powershell
nssm status lumina-backend          # SERVICE_RUNNING
curl http://localhost:3001/health   # {"ok":true}
```

### 2.7 Configurar IIS

```powershell
# Instalar IIS si no esta
Install-WindowsFeature -Name Web-Server, Web-Static-Content, Web-Http-Redirect -IncludeManagementTools

# Instalar modulos
msiexec /i installers\urlrewrite.msi /qn
msiexec /i installers\arr.msi /qn

# Habilitar proxy en ARR
Import-Module WebAdministration
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
    -filter "system.webServer/proxy" -name "enabled" -value "True"

# Crear sitio
New-WebAppPool -Name "lumina"
Set-ItemProperty "IIS:\AppPools\lumina" -Name processModel.identityType -Value "ApplicationPoolIdentity"

New-Website -Name "lumina" `
    -PhysicalPath "C:\inetpub\lumina\apps\frontend\dist" `
    -ApplicationPool "lumina" `
    -Port 8090
```

El `web.config` ya viene incluido en `apps\frontend\dist\web.config`.
Define las reglas de reverse proxy (API → localhost:3001) y SPA fallback.

### 2.8 Firewall

```powershell
New-NetFirewallRule -DisplayName "Lumina HTTP" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow
```

### 2.9 Windows Defender

```powershell
Add-MpPreference -ExclusionPath "C:\inetpub\lumina"
Add-MpPreference -ExclusionProcess "node.exe"
```

---

## Paso 3: Crear primer usuario

No hay pagina de registro. Crear usuario via script:

```powershell
cd C:\inetpub\lumina\apps\backend

node -e "require('dotenv').config();const{PrismaClient}=require('@prisma/client');const b=require('bcryptjs');const p=new PrismaClient();(async()=>{const h=await b.hash('PASSWORD',10);const u=await p.user.create({data:{name:'Admin',email:'admin@empresa.com',passwordHash:h,role:'superadmin'}});console.log('Created:',u.id,u.email);await p.$disconnect();})()"
```

> En PowerShell, si hay problemas con comillas, crear un archivo `create-user.js`:
> ```javascript
> require('dotenv').config();
> const { PrismaClient } = require('@prisma/client');
> const bcrypt = require('bcryptjs');
> const p = new PrismaClient();
> (async () => {
>   const h = await bcrypt.hash('PASSWORD_AQUI', 10);
>   const u = await p.user.create({
>     data: { name: 'Admin', email: 'admin@empresa.com', passwordHash: h, role: 'superadmin' }
>   });
>   console.log('Created:', u.id, u.email, u.role);
>   await p.$disconnect();
> })();
> ```
> Ejecutar: `node create-user.js` y luego borrar el archivo.

Roles disponibles: `superadmin` | `member`

---

## Verificacion post-deploy

```powershell
# 1. Servicio backend corriendo
nssm status lumina-backend

# 2. Health check del backend
curl http://localhost:3001/health
# Respuesta esperada: {"ok":true}

# 3. Health check via IIS (proxy)
curl http://localhost:8090/health
# Respuesta esperada: {"ok":true}

# 4. Login funciona
curl -X POST http://localhost:3001/auth/login `
    -H "Content-Type: application/json" `
    -d '{"email":"admin@empresa.com","password":"PASSWORD"}'
# Respuesta esperada: {"token":"eyJ...","user":{...}}

# 5. Base de datos
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U lumina_user -d lumina -c "\dt"
# Debe listar 18 tablas
```

---

## Estructura de archivos en servidor

```
C:\inetpub\lumina\
├── apps\
│   ├── backend\
│   │   ├── src\               # Codigo fuente Express
│   │   │   ├── index.js       # Entry point
│   │   │   ├── routes\        # auth, admin, datasets, reports, etc.
│   │   │   ├── services\      # dataParser, encryption, pdfExport
│   │   │   └── middleware\    # auth.js (JWT verification)
│   │   ├── prisma\
│   │   │   ├── schema.prisma  # Modelo de datos
│   │   │   └── migrations\    # Archivos SQL de migracion
│   │   ├── node_modules\      # Dependencias (NO borrar)
│   │   ├── uploads\           # Archivos subidos (CSV, Excel)
│   │   └── .env               # Configuracion (SECRETO)
│   └── frontend\
│       └── dist\              # Build compilado (estaticos)
│           ├── index.html
│           ├── assets\        # JS, CSS, imagenes
│           └── web.config     # Reglas IIS (rewrite + proxy)
├── logs\
│   ├── backend.log            # Stdout del backend
│   └── backend-error.log      # Stderr del backend
└── ...
```

---

## Troubleshooting

### Error: "permiso denegado a la tabla User"
Las migraciones se corrieron con un usuario distinto a `lumina_user`.
Ejecutar como postgres:
```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lumina_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO lumina_user;
```

### Error: "@prisma/client did not initialize yet"
Falta correr `prisma generate` o el engine binario no es para Windows.
```powershell
cd C:\inetpub\lumina\apps\backend
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node node_modules\prisma\build\index.js generate
```

### Error: "self-signed certificate in certificate chain"
Entorno corporativo con proxy SSL. Setear temporalmente:
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

### IIS devuelve 405 en POST
ARR no esta habilitado o web.config falta. Verificar:
```powershell
Import-Module WebAdministration
Get-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter "system.webServer/proxy" -name "enabled"
# Debe ser True
Test-Path "C:\inetpub\lumina\apps\frontend\dist\web.config"
# Debe ser True
```

### Frontend carga pero API falla (G.map is not a function)
El frontend recibe HTML en vez de JSON. IIS no esta haciendo proxy al backend.
Verificar que:
1. Backend corre en puerto 3001: `curl http://localhost:3001/health`
2. web.config tiene las reglas de rewrite
3. ARR proxy esta habilitado
4. iisreset despues de cambios

### Backend no arranca (NSSM)
```powershell
nssm status lumina-backend
Get-Content C:\inetpub\lumina\logs\backend-error.log -Tail 20
```
Causas comunes: .env falta o mal ubicado, node_modules incompleto, puerto ocupado.

### node_modules incompleto (servidor sin internet)
Si se copian node_modules desde otra maquina y faltan dependencias:
1. En maquina de desarrollo, fuera del monorepo:
   ```powershell
   mkdir C:\temp\deps
   Copy-Item C:\Proyectos\Lumina\apps\backend\package.json C:\temp\deps\
   cd C:\temp\deps
   $env:PUPPETEER_SKIP_DOWNLOAD = "true"
   npm install --omit=dev
   ```
2. Copiar `C:\temp\deps\node_modules` al servidor con `robocopy` (mejor que Copy-Item para paths largos):
   ```powershell
   robocopy C:\temp\deps\node_modules C:\inetpub\lumina\apps\backend\node_modules /E
   ```

---

## Actualizacion

```powershell
# 1. Respaldar .env
Copy-Item "C:\inetpub\lumina\apps\backend\.env" "$env:TEMP\lumina.env.bak"

# 2. Detener servicio
nssm stop lumina-backend

# 3. Reemplazar app (mantener logs)
Remove-Item "C:\inetpub\lumina\apps" -Recurse -Force
Copy-Item "app\apps" "C:\inetpub\lumina\apps" -Recurse -Force

# 4. Restaurar .env
Copy-Item "$env:TEMP\lumina.env.bak" "C:\inetpub\lumina\apps\backend\.env"

# 5. Migrar
cd C:\inetpub\lumina\apps\backend
node node_modules\prisma\build\index.js migrate deploy

# 6. Reiniciar
nssm start lumina-backend
iisreset
```

---

## Seguridad

- **Nunca** exponer el puerto 3001 al exterior (solo IIS en 80/443)
- El .env contiene secretos — no versionar, no copiar a lugares inseguros
- ENCRYPTION_KEY cifra credenciales de conectores (AES-256-GCM) — si se pierde, los conectores guardados quedan inutilizables
- Cambiar las contrasenas default antes de poner en produccion
- Considerar SSL con win-acme para HTTPS
