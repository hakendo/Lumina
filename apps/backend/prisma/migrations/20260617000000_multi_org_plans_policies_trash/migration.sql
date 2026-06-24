-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: multi-org membership, plan tiers, area policies, papelera
--
-- ORDEN CRÍTICO:
--   1. Crear Plan + poblar tiers default
--   2. Ampliar Organization (planId, storage, policy defaults)
--   3. Crear OrgMembership + poblar desde User.orgId/role existentes
--   4. Eliminar User.orgId (y su FK) — DESPUÉS de poblar OrgMembership
--   5. Crear AreaPolicy
--   6. Añadir deletedAt a Report y Dataset
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Plan ───────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Plan" (
    "id"                TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "retentionDays"     INTEGER NOT NULL DEFAULT 30,
    "maxUsers"          INTEGER,
    "storageLimitMB"    DOUBLE PRECISION,
    "allowPublicLinks"  BOOLEAN NOT NULL DEFAULT true,
    "allowExternalShare" BOOLEAN NOT NULL DEFAULT true,
    "syncRateLimit"     JSONB NOT NULL DEFAULT '{}',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- Seed default tiers
INSERT INTO "Plan" ("id", "name", "retentionDays", "maxUsers", "storageLimitMB", "allowPublicLinks", "allowExternalShare", "syncRateLimit") VALUES
    ('plan_consumer',   'consumer',   30,  10,   500,   false, false, '{"maxPerHour":10,"maxPerDay":50}'),
    ('plan_enterprise', 'enterprise', 90,  null, 10000, true,  true,  '{"maxPerHour":100,"maxPerDay":1000}'),
    ('plan_custom',     'custom',     90,  null, null,  true,  true,  '{}');

-- ── 2. Organization — nuevas columnas ─────────────────────────────────────────

ALTER TABLE "Organization"
    ADD COLUMN "planId"                    TEXT,
    ADD COLUMN "storageUsedMB"             DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "policyAllowPublicLink"     BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "policyAllowExternalShare"  BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "policyAllowPublishToArea"  BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "policyAllowCreateReport"   BOOLEAN NOT NULL DEFAULT true;

-- Asignar plan 'enterprise' a todas las orgs existentes como default seguro
UPDATE "Organization" SET "planId" = 'plan_enterprise';

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. OrgMembership ─────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "OrgMembership" (
    "id"       TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "orgId"    TEXT NOT NULL,
    "role"     TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembership_userId_orgId_key" ON "OrgMembership"("userId", "orgId");

-- Data migration: poblar OrgMembership desde User.orgId + User.role
-- org_admin en User.role → org_admin en OrgMembership.role
-- El resto → member
INSERT INTO "OrgMembership" ("id", "userId", "orgId", "role", "joinedAt")
SELECT
    gen_random_uuid()::TEXT,
    "id",
    "orgId",
    CASE WHEN "role" = 'org_admin' THEN 'org_admin' ELSE 'member' END,
    "createdAt"
FROM "User"
WHERE "orgId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. User — eliminar orgId, normalizar role ─────────────────────────────────

-- Actualizar role: org_admin → member (el rol de org ahora vive en OrgMembership)
UPDATE "User" SET "role" = 'member' WHERE "role" = 'org_admin';

-- Eliminar FK y columna orgId
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_orgId_fkey";
ALTER TABLE "User" DROP COLUMN "orgId";

-- ── 5. AreaPolicy ─────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "AreaPolicy" (
    "id"                   TEXT NOT NULL,
    "areaId"               TEXT NOT NULL,
    "allowPublicLink"      BOOLEAN NOT NULL DEFAULT true,
    "allowExternalShare"   BOOLEAN NOT NULL DEFAULT true,
    "allowPublishToArea"   BOOLEAN NOT NULL DEFAULT true,
    "allowCreateReport"    BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AreaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AreaPolicy_areaId_key" ON "AreaPolicy"("areaId");

-- AddForeignKey
ALTER TABLE "AreaPolicy" ADD CONSTRAINT "AreaPolicy_areaId_fkey"
    FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 6. Papelera — soft-delete en Report y Dataset ─────────────────────────────

ALTER TABLE "Report"  ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Dataset" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Índices para queries de papelera y purga automática eficientes
CREATE INDEX "Report_deletedAt_idx"  ON "Report"("deletedAt")  WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Dataset_deletedAt_idx" ON "Dataset"("deletedAt") WHERE "deletedAt" IS NOT NULL;
