-- ═══════════════════════════════════════════════════════════════════
-- Migration: add_orgs_areas_pages
-- Adds multi-tenant Organization/Area model and multi-page reports.
-- Includes data migration for existing rows.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Nuevas tablas ──────────────────────────────────────────────

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AreaMember" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "AreaMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AreaMember_areaId_userId_key" ON "AreaMember"("areaId", "userId");

CREATE TABLE "ReportPage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Página 1',
    "order" INTEGER NOT NULL DEFAULT 0,
    "layout" JSONB NOT NULL DEFAULT '[]',
    "filters" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "ReportPage_pkey" PRIMARY KEY ("id")
);

-- ── 2. Nuevas columnas (nullable para la migración de datos) ──────

ALTER TABLE "User"        ADD COLUMN "orgId" TEXT;
ALTER TABLE "Dataset"     ADD COLUMN "areaId" TEXT;
ALTER TABLE "Dataset"     ADD COLUMN "uploadedById" TEXT;
ALTER TABLE "Report"      ADD COLUMN "areaId" TEXT;
ALTER TABLE "ReportWidget" ADD COLUMN "pageId" TEXT;

-- ── 3. Migración de datos ─────────────────────────────────────────

DO $$
DECLARE
  default_org_id TEXT := 'org_default_lumina';
  default_area_id TEXT := 'area_default_general';
  r RECORD;
  page_id TEXT;
BEGIN

  -- 3a. Organización y área por defecto para datos legados
  INSERT INTO "Organization" ("id", "name", "slug", "isActive")
  VALUES (default_org_id, 'Mi Organización', 'mi-organizacion', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO "Area" ("id", "orgId", "name")
  VALUES (default_area_id, default_org_id, 'General')
  ON CONFLICT DO NOTHING;

  -- 3b. Todos los usuarios no-superadmin → org por defecto, rol user→member
  UPDATE "User"
  SET "orgId" = default_org_id,
      "role"  = CASE WHEN "role" = 'user' THEN 'member' ELSE "role" END
  WHERE "role" != 'superadmin';

  -- 3c. Todos los usuarios no-superadmin → miembros del área General
  INSERT INTO "AreaMember" ("id", "areaId", "userId")
  SELECT gen_random_uuid()::TEXT, default_area_id, "id"
  FROM "User"
  WHERE "role" != 'superadmin'
  ON CONFLICT DO NOTHING;

  -- 3d. Datasets existentes → área General, uploadedById = ownerId previo
  UPDATE "Dataset"
  SET "areaId"       = default_area_id,
      "uploadedById" = "ownerId"
  WHERE "areaId" IS NULL;

  -- 3e. Crear una ReportPage por cada Report existente, copiando layout y filters
  FOR r IN SELECT "id", "layout", "filters" FROM "Report" LOOP
    page_id := gen_random_uuid()::TEXT;
    INSERT INTO "ReportPage" ("id", "reportId", "title", "order", "layout", "filters")
    VALUES (page_id, r.id, 'Página 1', 0, r.layout, r.filters);

    -- 3f. Mover widgets de este reporte a su página por defecto
    UPDATE "ReportWidget"
    SET "pageId" = page_id
    WHERE "reportId" = r.id;
  END LOOP;

END $$;

-- ── 4. Eliminar columnas obsoletas (DESPUÉS de migrar datos) ──────

ALTER TABLE "Dataset" DROP CONSTRAINT "Dataset_ownerId_fkey";
ALTER TABLE "Dataset" DROP COLUMN "ownerId";
ALTER TABLE "Report"  DROP COLUMN "layout";
ALTER TABLE "Report"  DROP COLUMN "filters";

-- ── 5. Default de role en User ────────────────────────────────────

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'member';

-- ── 6. Foreign keys ───────────────────────────────────────────────

ALTER TABLE "Area"        ADD CONSTRAINT "Area_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AreaMember"  ADD CONSTRAINT "AreaMember_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AreaMember"  ADD CONSTRAINT "AreaMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User"        ADD CONSTRAINT "User_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Dataset"     ADD CONSTRAINT "Dataset_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Dataset"     ADD CONSTRAINT "Dataset_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Report"      ADD CONSTRAINT "Report_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReportPage"  ADD CONSTRAINT "ReportPage_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportWidget" ADD CONSTRAINT "ReportWidget_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "ReportPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
