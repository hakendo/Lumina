<#
.SYNOPSIS
    Genera el paquete de release de Lúmina para despliegue offline en Windows Server 2022.
.DESCRIPTION
    Descarga todos los instaladores, compila la app y empaqueta todo en un ZIP
    listo para transferir al servidor sin acceso a internet.
    Ejecutar desde la raiz del repositorio en una maquina con acceso a internet.
.PARAMETER Version
    Etiqueta de version para el nombre del release (default: fecha actual YYYY-MM-DD).
.PARAMETER NodeVersion
    Version de Node.js LTS a incluir.
.PARAMETER PgVersion
    Version de PostgreSQL a incluir (formato X.Y-Z, ej: 17.2-1).
.EXAMPLE
    .\scripts\make-release.ps1
.EXAMPLE
    .\scripts\make-release.ps1 -Version "1.2.0"
#>
param(
    [string]$Version    = (Get-Date -Format "yyyy-MM-dd"),
    [string]$NodeVersion = "22.14.0",
    [string]$PgVersion   = "17.2-1"
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Verificar que corremos desde la raiz del repo
if (-not (Test-Path ".\package.json")) {
    Write-Error "Ejecutar desde la raiz del repositorio: .\scripts\make-release.ps1"
    exit 1
}

$releaseDir = ".\lumina-release-$Version"
$zipPath    = ".\lumina-release-$Version.zip"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }

# ── Limpiar release anterior ──────────────────────────────────────────────────
Step "Preparando directorio de release..."
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
if (Test-Path $zipPath)    { Remove-Item $zipPath -Force }

New-Item -ItemType Directory -Force -Path "$releaseDir\installers\nssm" | Out-Null
New-Item -ItemType Directory -Force -Path "$releaseDir\app"             | Out-Null
Ok "Directorio listo: $releaseDir"

# ── Descargar instaladores ────────────────────────────────────────────────────
Step "Descargando Node.js $NodeVersion..."
Invoke-WebRequest `
    "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi" `
    -OutFile "$releaseDir\installers\node.msi"
Ok "node.msi"

Step "Descargando PostgreSQL $PgVersion..."
Invoke-WebRequest `
    "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64.exe" `
    -OutFile "$releaseDir\installers\postgresql.exe"
Ok "postgresql.exe"

Step "Descargando NSSM..."
Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip"
Expand-Archive "$env:TEMP\nssm.zip" -DestinationPath "$releaseDir\installers\nssm\" -Force
Ok "nssm\ (extraido)"

Step "Descargando IIS URL Rewrite Module 2.1..."
Invoke-WebRequest `
    "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" `
    -OutFile "$releaseDir\installers\urlrewrite.msi"
Ok "urlrewrite.msi"

Step "Descargando IIS Application Request Routing 3.0..."
Invoke-WebRequest `
    "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" `
    -OutFile "$releaseDir\installers\arr.msi"
Ok "arr.msi"

# ── Compilar app ──────────────────────────────────────────────────────────────
Step "Instalando dependencias npm..."
npm install
Ok "node_modules listo"

Step "Compilando frontend (Vite)..."
Push-Location apps\frontend
npm run build
Pop-Location
Ok "dist/ generado"

# ── Copiar app al release ─────────────────────────────────────────────────────
Step "Copiando archivos de la app..."
Get-ChildItem -Path "." -Exclude @('.git', '.claude', '*.zip', 'lumina-release-*') |
    Copy-Item -Destination "$releaseDir\app\" -Recurse -Force
Ok "App copiada"

# ── Copiar script de instalacion ──────────────────────────────────────────────
Step "Copiando instalar.ps1..."
Copy-Item ".\scripts\instalar.ps1" "$releaseDir\instalar.ps1"
Ok "instalar.ps1"

# ── Generar INSTALACION.md ────────────────────────────────────────────────────
Step "Generando INSTALACION.md..."
$guide = @"
# Guia de instalacion — Lumina $Version
Windows Server 2022 + IIS + NSSM

## Contenido del paquete

```
lumina-release-$Version/
├── installers/
│   ├── node.msi           Node.js $NodeVersion LTS
│   ├── postgresql.exe     PostgreSQL $PgVersion
│   ├── nssm/              NSSM 2.24
│   ├── urlrewrite.msi     IIS URL Rewrite Module 2.1
│   └── arr.msi            IIS Application Request Routing 3.0
├── app/                   App completa con node_modules y dist/
├── instalar.ps1           Instalador automatico
└── INSTALACION.md         Esta guia
```

## Instalacion automatica (recomendado)

1. Copia esta carpeta al servidor (USB, recurso compartido de red, etc.)
2. Abre **PowerShell como Administrador** en el servidor
3. Navega a esta carpeta y ejecuta:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\instalar.ps1 -Domain "tu-dominio.com"
```

El script realiza todos los pasos automaticamente:
- Instala Node.js, PostgreSQL 17, NSSM, URL Rewrite y ARR
- Crea el usuario y base de datos PostgreSQL
- Despliega la app en C:\inetpub\lumina
- Crea el .env (solicita valores por pantalla)
- Aplica migraciones Prisma
- Registra lumina-backend como servicio de Windows
- Instala IIS y configura el proxy inverso + SPA routing
- Abre puertos 80 y 443 en el firewall
- Configura exclusiones de Windows Defender

## Parametros de instalar.ps1

| Parametro      | Descripcion                   | Default              |
|----------------|-------------------------------|----------------------|
| ``-Domain``    | Dominio o IP del servidor     | ``localhost``        |
| ``-InstallPath`` | Ruta de instalacion         | ``C:\inetpub\lumina``|

## Instalacion manual (paso a paso)

### 1. Prerrequisitos

```powershell
# Node.js
Start-Process msiexec.exe -ArgumentList '/i "installers\node.msi" /qn ADDLOCAL=ALL' -Wait

# PostgreSQL (cambiar TU_PASSWORD)
Start-Process "installers\postgresql.exe" ``
  -ArgumentList "--unattendedmodeui none --mode unattended --superpassword TU_PASSWORD --servicename postgresql-x64-17" ``
  -Wait

# NSSM
Copy-Item "installers\nssm\win64\nssm.exe" "C:\Windows\System32\nssm.exe"
```

Cierra y vuelve a abrir PowerShell como Administrador.

### 2. Base de datos

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres
```

```sql
CREATE USER lumina_user WITH PASSWORD 'password_seguro';
CREATE DATABASE lumina OWNER lumina_user;
GRANT ALL PRIVILEGES ON DATABASE lumina TO lumina_user;
\q
```

### 3. Desplegar app

```powershell
Copy-Item "app\*" "C:\inetpub\lumina" -Recurse -Force
New-Item -ItemType Directory -Force -Path "C:\inetpub\lumina\logs"
Copy-Item "app\apps\backend\.env.example" "C:\inetpub\lumina\apps\backend\.env"
notepad "C:\inetpub\lumina\apps\backend\.env"
```

Valores requeridos en .env:
- DATABASE_URL  →  postgresql://lumina_user:PASSWORD@localhost:5432/lumina
- JWT_SECRET    →  string aleatorio largo (min 32 chars)
- ENCRYPTION_KEY→  64 caracteres hexadecimales
- PORT          →  3001
- UPLOAD_DIR    →  C:\\inetpub\\lumina\\apps\\backend\\uploads
- FRONTEND_URL  →  https://tu-dominio.com
- NODE_ENV      →  production

```powershell
Push-Location C:\inetpub\lumina\apps\backend
node node_modules\.bin\prisma migrate deploy
Pop-Location
```

### 4. Servicio Windows

```powershell
New-Item -ItemType Directory -Force -Path "C:\inetpub\lumina\logs"
nssm install lumina-backend "C:\Program Files\nodejs\node.exe"
nssm set lumina-backend AppDirectory        "C:\inetpub\lumina\apps\backend"
nssm set lumina-backend AppParameters       "src\index.js"
nssm set lumina-backend AppEnvironmentExtra "NODE_ENV=production"
nssm set lumina-backend DisplayName         "Lumina Backend"
nssm set lumina-backend Start               SERVICE_AUTO_START
nssm set lumina-backend AppStdout           "C:\inetpub\lumina\logs\backend.log"
nssm set lumina-backend AppStderr           "C:\inetpub\lumina\logs\backend-error.log"
nssm set lumina-backend AppRotateFiles      1
nssm start lumina-backend
nssm status lumina-backend   # debe mostrar SERVICE_RUNNING
```

### 5. IIS

```powershell
Install-WindowsFeature -Name Web-Server, Web-Static-Content, Web-Http-Redirect -IncludeManagementTools

Start-Process msiexec.exe -ArgumentList '/i "installers\urlrewrite.msi" /qn' -Wait
Start-Process msiexec.exe -ArgumentList '/i "installers\arr.msi" /qn' -Wait

Import-Module WebAdministration
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' ``
  -filter "system.webServer/proxy" -name "enabled" -value "True"

New-WebAppPool -Name "lumina"
Set-ItemProperty "IIS:\AppPools\lumina" -Name processModel.identityType -Value "ApplicationPoolIdentity"

New-Website -Name "lumina" ``
  -PhysicalPath "C:\inetpub\lumina\apps\frontend\dist" ``
  -ApplicationPool "lumina" -Port 80 -HostHeader "tu-dominio.com"
```

El web.config ya esta incluido en ``app\apps\frontend\dist\web.config``.

### 6. Firewall y Defender

```powershell
New-NetFirewallRule -DisplayName "Lumina HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "Lumina HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
Add-MpPreference -ExclusionPath    "C:\inetpub\lumina"
Add-MpPreference -ExclusionProcess "node.exe"
```

### 7. SSL (opcional)

Instalar win-acme (https://www.win-acme.com/), extraer en C:\win-acme y ejecutar:

```powershell
cd C:\win-acme
.\wacs.exe
# Seleccionar "Create new certificate" > sitio IIS "lumina" > confirmar dominio
```

## Verificacion

```powershell
nssm status lumina-backend          # SERVICE_RUNNING
curl http://localhost:3001/health   # {"status":"ok"} o similar
```

## Actualizacion

```powershell
# Respaldar .env
Copy-Item "C:\inetpub\lumina\apps\backend\.env" "$env:TEMP\lumina.env.bak"

# Reemplazar app
nssm stop lumina-backend
Remove-Item "C:\inetpub\lumina" -Recurse -Force
Copy-Item "app\*" "C:\inetpub\lumina" -Recurse -Force

# Restaurar .env
Copy-Item "$env:TEMP\lumina.env.bak" "C:\inetpub\lumina\apps\backend\.env"

# Migrar y reiniciar
Push-Location C:\inetpub\lumina\apps\backend
node node_modules\.bin\prisma migrate deploy
Pop-Location
nssm start lumina-backend
```
"@

Set-Content "$releaseDir\INSTALACION.md" $guide -Encoding UTF8
Ok "INSTALACION.md generado"

# ── Comprimir ─────────────────────────────────────────────────────────────────
Step "Comprimiendo release..."
Compress-Archive -Path "$releaseDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $releaseDir -Recurse -Force
Ok $zipPath

# ── Resumen ───────────────────────────────────────────────────────────────────
$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  Release listo: $zipPath ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "  Pasos siguientes:" -ForegroundColor White
Write-Host "  1. Transferir $zipPath al servidor" -ForegroundColor White
Write-Host "  2. Extraer el ZIP en el servidor" -ForegroundColor White
Write-Host "  3. Abrir PowerShell como Administrador" -ForegroundColor White
Write-Host "  4. Ejecutar: .\instalar.ps1 -Domain tu-dominio.com" -ForegroundColor White
Write-Host "=================================================" -ForegroundColor Green
