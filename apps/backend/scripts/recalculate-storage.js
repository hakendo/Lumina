/**
 * One-time fix: recomputes Organization.storageUsedMB from actual DatasetRow
 * bytes, for every org. Needed because datasets with no areaId (private,
 * unshared) used to silently not count toward any org's storage — see
 * updateOrgStorage() in routes/datasets.js.
 *
 * Resolves each dataset's owning org the same way the live fix does:
 *   1. via dataset.areaId -> Area.orgId, if set
 *   2. else via dataset.uploadedById's first OrgMembership
 * Datasets matching neither (orphaned/no membership) are left out, same as
 * the live code — they don't count against any plan.
 *
 * Usage: node scripts/recalculate-storage.js [--dry-run]
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, storageUsedMB: true } });
  if (!orgs.length) {
    console.log('No organizations found.');
    return;
  }

  const areas = await prisma.area.findMany({ select: { id: true, orgId: true } });
  const areaOrgMap = new Map(areas.map((a) => [a.id, a.orgId]));

  const memberships = await prisma.orgMembership.findMany({ select: { userId: true, orgId: true } });
  const userOrgMap = new Map();
  for (const m of memberships) {
    if (!userOrgMap.has(m.userId)) userOrgMap.set(m.userId, m.orgId); // first wins, matches findFirst() in the live fix
  }

  const datasets = await prisma.dataset.findMany({ select: { id: true, areaId: true, uploadedById: true } });

  const orgDatasetIds = new Map();
  let unresolved = 0;
  for (const d of datasets) {
    let orgId = d.areaId ? areaOrgMap.get(d.areaId) : null;
    if (!orgId && d.uploadedById) orgId = userOrgMap.get(d.uploadedById);
    if (!orgId) { unresolved++; continue; }
    if (!orgDatasetIds.has(orgId)) orgDatasetIds.set(orgId, []);
    orgDatasetIds.get(orgId).push(d.id);
  }

  console.log(`${datasets.length} dataset(s) total, ${unresolved} unresolved (no area, no org membership — excluded).\n`);

  for (const org of orgs) {
    const ids = orgDatasetIds.get(org.id) || [];
    let bytes = 0;
    if (ids.length) {
      const result = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(octet_length("rowData"::text)), 0)::bigint AS bytes FROM "DatasetRow" WHERE "datasetId" = ANY($1::text[])`,
        ids,
      );
      bytes = Number(result[0].bytes);
    }
    const newMB = bytes / (1024 * 1024);
    const oldMB = org.storageUsedMB;
    const changed = Math.abs(newMB - oldMB) > 0.01;
    console.log(
      `${changed ? '⚠' : '✓'} ${org.name} (${org.id}): ${oldMB.toFixed(2)} MB -> ${newMB.toFixed(2)} MB  [${ids.length} dataset(s)]`,
    );
    if (!DRY_RUN && changed) {
      await prisma.organization.update({ where: { id: org.id }, data: { storageUsedMB: newMB } });
    }
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes written. Run without --dry-run to apply.');
  } else {
    console.log('\nDone.');
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
