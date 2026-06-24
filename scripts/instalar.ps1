#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Instalador de Lumina para Windows Server 2022 (IIS + NSSM).
.DESCRIPTION
    Instala prerrequisitos, despliega la app, configura PostgreSQL,
    registra el servicio de Windows y configura IIS.
    Ejecutar desde la carpeta raiz del release (donde estan installers\ y app\).
.PARAMETER Domain
    Dominio del servidor. Se usa en FRONTEND_URL y como HostHeader en IIS.
    Si se omite o se deja vacio, IIS escucha en todas las IPs (sin HostHeader)
    y FRONTEND_URL se genera con la IP local del servidor.
.PARAMETER InstallPath
    Ruta de instalacion de la app en el servidor.
.PARAMETER PgHost
    Host de PostgreSQL. Default: localhost. Cambiar si el servidor de BD es externo.
.PARAMETER PgPort
    Puerto de PostgreSQL. Default: 5432.
.PARAMETER Port
    Puerto HTTP en el que IIS escucha. Default: 80. Cambiar si el servidor ya usa el 80 con otra app.
.PARAMETER BackendPort
    Puerto del backend Node.js. Default: 3001. Cambiar si hay otra app en ese puerto.
.PARAMETER SkipPgInstall
    Si se especifica, no instala PostgreSQL (usar cuando ya hay un servidor PostgreSQL existente).
.EXAMPLE
    .\instalar.ps1 -Domain "lumina.empresa.com"
.EXAMPLE
    .\instalar.ps1 -SkipPgInstall -PgHost "192.168.1.50"
.EXAMPLE
    .\instalar.ps1
#>
param(
    [string]$Domain      = "",
    [string]$InstallPath = "C:\inetpub\lumina",
    [string]$PgHost      = "localhost",
    [string]$PgPort      = "5432",
    [int]$Port           = 80,
    [int]$BackendPort    = 3001,
    [switch]$SkipPgInstall
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Ask([string]$prompt, [string]$default = "") {
    $val = Read-Host "$prompt$(if ($default) { " [$default]" })"
    if (-not $val -and $default) { return $default }
    return $val
}

# -- 1. Detectar prerrequisitos ------------------------------------------------
Step "Detectando software instalado..."

$hasNode   = [bool](Get-Command node -ErrorAction SilentlyContinue)
$hasNssm   = [bool](Get-Command nssm -ErrorAction SilentlyContinue)
$hasPg     = [bool](Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Running" })
$hasIIS    = [bool](Get-WindowsFeature Web-Server -ErrorAction SilentlyContinue | Where-Object { $_.Installed })
$hasRewrite = Test-Path "HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite"
$hasARR    = Test-Path "HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing"

Write-Host ""
Write-Host "  Componente         Estado" -ForegroundColor White
Write-Host "  ---------          ------" -ForegroundColor White
Write-Host "  Node.js            $(if ($hasNode) { 'INSTALADO (' + (node --version) + ')' } else { 'NO ENCONTRADO' })" -ForegroundColor $(if ($hasNode) { 'Green' } else { 'Yellow' })
Write-Host "  PostgreSQL         $(if ($hasPg) { 'CORRIENDO' } else { 'NO ENCONTRADO' })" -ForegroundColor $(if ($hasPg) { 'Green' } else { 'Yellow' })
Write-Host "  NSSM               $(if ($hasNssm) { 'INSTALADO' } else { 'NO ENCONTRADO' })" -ForegroundColor $(if ($hasNssm) { 'Green' } else { 'Yellow' })
Write-Host "  IIS                $(if ($hasIIS) { 'INSTALADO' } else { 'NO ENCONTRADO' })" -ForegroundColor $(if ($hasIIS) { 'Green' } else { 'Yellow' })
Write-Host "  URL Rewrite        $(if ($hasRewrite) { 'INSTALADO' } else { 'NO ENCONTRADO' })" -ForegroundColor $(if ($hasRewrite) { 'Green' } else { 'Yellow' })
Write-Host "  ARR                $(if ($hasARR) { 'INSTALADO' } else { 'NO ENCONTRADO' })" -ForegroundColor $(if ($hasARR) { 'Green' } else { 'Yellow' })
Write-Host ""

# -- Menu interactivo ----------------------------------------------------------
$toInstall = @()
if (-not $hasNode)     { $toInstall += "Node.js" }
if (-not $hasPg -and -not $SkipPgInstall) { $toInstall += "PostgreSQL" }
if (-not $hasNssm)     { $toInstall += "NSSM" }
if (-not $hasIIS)      { $toInstall += "IIS" }
if (-not $hasRewrite)  { $toInstall += "URL Rewrite" }
if (-not $hasARR)      { $toInstall += "ARR" }

if ($toInstall.Count -gt 0) {
    Write-Host "  Componentes a instalar: $($toInstall -join ', ')" -ForegroundColor Cyan
    Write-Host ""
    $confirm = Ask "Continuar con la instalacion? (S/n)" "S"
    if ($confirm -notin @("S", "s", "Y", "y", "")) {
        Write-Host "Instalacion cancelada." -ForegroundColor Red
        exit 0
    }
} else {
    Write-Host "  Todos los prerrequisitos ya estan instalados." -ForegroundColor Green
    Write-Host ""
}

# -- Instalar solo lo que falta ------------------------------------------------
if (-not $hasNode) {
    Step "Instalando Node.js 22 LTS..."
    Start-Process msiexec.exe -ArgumentList "/i `"$root\installers\node.msi`" /qn ADDLOCAL=ALL" -Wait
    Ok "Node.js instalado"
} else {
    Warn "Node.js ya instalado, omitiendo"
}

if ($hasPg -or $SkipPgInstall) {
    if ($hasPg) { Warn "PostgreSQL ya corriendo, omitiendo instalacion" }
    $pgSuperPass = Ask "Contrasena del superusuario 'postgres' (servidor existente)"
    $pgBin = (Get-ItemProperty "HKLM:\SOFTWARE\PostgreSQL\Installations\*" -ErrorAction SilentlyContinue | Select-Object -First 1).Base_Directory
    if ($pgBin) { $pgBin = "$pgBin\bin" } else { $pgBin = Ask "Ruta al directorio bin de PostgreSQL (ej: C:\Program Files\PostgreSQL\17\bin)" }
} else {
    Step "Instalando PostgreSQL 17..."
    $pgSuperPass = Ask "Contrasena para el superusuario 'postgres' (nueva instalacion)"
    Start-Process "$root\installers\postgresql.exe" `
        -ArgumentList "--unattendedmodeui none --mode unattended --superpassword `"$pgSuperPass`" --servicename postgresql-x64-17" `
        -Wait
    $pgBin = "C:\Program Files\PostgreSQL\17\bin"
    Ok "PostgreSQL instalado"
}

if (-not $hasNssm) {
    Step "Instalando NSSM..."
    Copy-Item "$root\installers\nssm\nssm-2.24\win64\nssm.exe" "C:\Windows\System32\nssm.exe" -Force
    Ok "NSSM instalado"
} else {
    Warn "NSSM ya instalado, omitiendo"
}

# Refrescar PATH sin reabrir PowerShell
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("PATH", "User")

# -- 2. Desplegar app ----------------------------------------------------------
Step "Desplegando app en $InstallPath..."

$envBackup  = $null
$envDest    = "$InstallPath\apps\backend\.env"

if (Test-Path $envDest) {
    $envBackup = Get-Content $envDest -Raw
    Write-Host "    .env existente respaldado en memoria"
}

if (Test-Path $InstallPath) {
    Remove-Item $InstallPath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
Copy-Item "$root\app\*" -Destination $InstallPath -Recurse -Force
New-Item -ItemType Directory -Force -Path "$InstallPath\logs" | Out-Null
Ok "App desplegada"

# -- 3. Configurar .env --------------------------------------------------------
Step "Configurando .env..."

if ($envBackup) {
    Set-Content $envDest $envBackup -Encoding UTF8
    Write-Host "    .env restaurado desde instalacion anterior"
} else {
    $dbPass    = Ask "Contrasena para lumina_user (base de datos)"
    $jwtSecret = Ask "JWT_SECRET (string aleatorio, minimo 32 caracteres)"
    $encKey    = Ask "ENCRYPTION_KEY (exactamente 64 caracteres hexadecimales)"

    # Resolver FRONTEND_URL
    if ($Domain) {
        $frontendUrl = "https://$Domain"
    } else {
        $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
        $frontendUrl = "http://$localIp"
        Write-Host "    Dominio no especificado. Usando IP local: $localIp"
    }

    $uploadDir = ($InstallPath -replace '\\', '\\') + "\\apps\\backend\\uploads"

    $envContent = @"
DATABASE_URL="postgresql://lumina_user:$dbPass@${PgHost}:${PgPort}/lumina"
JWT_SECRET="$jwtSecret"
ENCRYPTION_KEY="$encKey"
PORT=$BackendPort
UPLOAD_DIR="$uploadDir"
FRONTEND_URL="$frontendUrl"
NODE_ENV=production
"@
    Set-Content $envDest $envContent -Encoding UTF8
    Ok ".env creado"

    # Crear usuario y base de datos (IF NOT EXISTS para no fallar si ya existen)
    Step "Creando usuario y base de datos PostgreSQL..."
    $savedPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $env:PGPASSWORD = $pgSuperPass
    & "$pgBin\psql.exe" -U postgres -h $PgHost -p $PgPort -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='lumina_user') THEN CREATE USER lumina_user WITH PASSWORD '$dbPass'; END IF; END `$`$;" 2>&1 | Out-Null
    & "$pgBin\psql.exe" -U postgres -h $PgHost -p $PgPort -c "SELECT 1 FROM pg_database WHERE datname='lumina'" 2>&1 | Out-Null
    & "$pgBin\psql.exe" -U postgres -h $PgHost -p $PgPort -c "CREATE DATABASE lumina OWNER lumina_user;" 2>&1 | Out-Null
    & "$pgBin\psql.exe" -U postgres -h $PgHost -p $PgPort -c "GRANT ALL PRIVILEGES ON DATABASE lumina TO lumina_user;" 2>&1 | Out-Null
    $env:PGPASSWORD = $null
    $ErrorActionPreference = $savedPref
    Ok "Base de datos configurada"
}

# -- 4. Migraciones ------------------------------------------------------------
Step "Aplicando migraciones Prisma..."
Push-Location "$InstallPath\apps\backend"
& node node_modules\prisma\build\index.js migrate deploy
Pop-Location
Ok "Migraciones aplicadas"

# -- 5. Servicio Windows (NSSM) ------------------------------------------------
Step "Registrando servicio lumina-backend..."

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = "C:\Program Files\nodejs\node.exe" }

# Limpiar registro previo si existe (ignorar errores si no existe)
$savedPref2 = $ErrorActionPreference
$ErrorActionPreference = "Continue"
nssm stop   lumina-backend 2>&1 | Out-Null
nssm remove lumina-backend confirm 2>&1 | Out-Null
$ErrorActionPreference = $savedPref2

nssm install lumina-backend $nodePath
nssm set lumina-backend AppDirectory        "$InstallPath\apps\backend"
nssm set lumina-backend AppParameters       "src\index.js"
nssm set lumina-backend AppEnvironmentExtra "NODE_ENV=production"
nssm set lumina-backend DisplayName         "Lumina Backend"
nssm set lumina-backend Description         "Lumina BI - API Node.js"
nssm set lumina-backend Start               SERVICE_AUTO_START
nssm set lumina-backend AppStdout           "$InstallPath\logs\backend.log"
nssm set lumina-backend AppStderr           "$InstallPath\logs\backend-error.log"
nssm set lumina-backend AppRotateFiles      1

nssm start lumina-backend
Ok "Servicio registrado e iniciado"

# -- 6. IIS --------------------------------------------------------------------
if (-not $hasIIS) {
    Step "Instalando IIS..."
    Install-WindowsFeature -Name Web-Server, Web-Static-Content, Web-Http-Redirect -IncludeManagementTools | Out-Null
    Ok "IIS instalado"
} else {
    Warn "IIS ya instalado, omitiendo"
}

if (-not $hasRewrite) {
    Step "Instalando IIS URL Rewrite Module 2.1..."
    Start-Process msiexec.exe -ArgumentList "/i `"$root\installers\urlrewrite.msi`" /qn" -Wait
    Ok "URL Rewrite instalado"
} else {
    Warn "URL Rewrite ya instalado, omitiendo"
}

if (-not $hasARR) {
    Step "Instalando IIS Application Request Routing 3.0..."
    Start-Process msiexec.exe -ArgumentList "/i `"$root\installers\arr.msi`" /qn" -Wait
    Ok "ARR instalado"
} else {
    Warn "ARR ya instalado, omitiendo"
}

Step "Habilitando proxy en ARR..."
Import-Module WebAdministration -ErrorAction SilentlyContinue
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
    -filter "system.webServer/proxy" -name "enabled" -value "True" -ErrorAction SilentlyContinue
Ok "Proxy ARR habilitado"

Step "Creando grupo de aplicaciones y sitio IIS..."
$distPath = "$InstallPath\apps\frontend\dist"

if (Get-WebAppPoolState -Name "lumina" -ErrorAction SilentlyContinue) {
    Remove-WebAppPool -Name "lumina"
}
New-WebAppPool -Name "lumina"
Set-ItemProperty "IIS:\AppPools\lumina" -Name processModel.identityType -Value "ApplicationPoolIdentity"

if (Get-Website -Name "lumina" -ErrorAction SilentlyContinue) {
    Remove-Website -Name "lumina"
}
$siteParams = @{
    Name            = "lumina"
    PhysicalPath    = $distPath
    ApplicationPool = "lumina"
    Port            = $Port
}
if ($Domain) { $siteParams.HostHeader = $Domain }
New-Website @siteParams
if ($Domain) {
    Ok "Sitio IIS creado (dominio: $Domain)"
} else {
    Ok "Sitio IIS creado (sin HostHeader, responde en todas las IPs, puerto $Port)"
}

Step "Escribiendo web.config..."
$backendUrl = "http://localhost:$BackendPort"
$webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="API Proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="$backendUrl/api/{R:1}" />
        </rule>
        <rule name="Health" stopProcessing="true">
          <match url="^health$" />
          <action type="Rewrite" url="$backendUrl/health" />
        </rule>
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
"@
Set-Content "$distPath\web.config" $webConfig -Encoding UTF8
Ok "web.config escrito"

# -- 7. Firewall ---------------------------------------------------------------
Step "Configurando reglas de firewall..."
New-NetFirewallRule -DisplayName "Lumina HTTP"  -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -ErrorAction SilentlyContinue
if ($Port -ne 443) {
    New-NetFirewallRule -DisplayName "Lumina HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue
}
Ok "Reglas creadas (puerto $Port)"

# -- 8. Windows Defender -------------------------------------------------------
Step "Configurando exclusiones de Windows Defender..."
Add-MpPreference -ExclusionPath    $InstallPath
Add-MpPreference -ExclusionProcess "node.exe"
Ok "Exclusiones configuradas"

# -- Resumen -------------------------------------------------------------------
$appUrl = if ($Domain) { "http://$Domain" } else { "http://$localIp" }
Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  Instalacion completada." -ForegroundColor Green
Write-Host ""
Write-Host "  Verificar backend:  nssm status lumina-backend" -ForegroundColor White
Write-Host "  Health check:       curl http://localhost:$BackendPort/health" -ForegroundColor White
Write-Host "  App:                ${appUrl}$(if ($Port -ne 80) { ":$Port" })" -ForegroundColor White
Write-Host "  PostgreSQL:         ${PgHost}:${PgPort}" -ForegroundColor White
Write-Host ""
if ($Domain) {
    Write-Host "  SSL: instalar win-acme desde https://www.win-acme.com/" -ForegroundColor Yellow
}
Write-Host "=================================================" -ForegroundColor Green
