/**
 * Repair script: creates OrgMembership for users who have activity in an org
 * (area membership, report ownership, dataset ownership) but no OrgMembership entry.
 *
 * Safe to run multiple times — uses upsert.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Build map: userId -> Set<orgId> from all available signals
  const userOrgMap = new Map(); // userId -> Set<orgId>

  const addMapping = (userId, orgId) => {
    if (!userId || !orgId) return;
    if (!userOrgMap.has(userId)) userOrgMap.set(userId, new Set());
    userOrgMap.get(userId).add(orgId);
  };

  // Signal 1: AreaMember → area.orgId
  const areaMembers = await prisma.areaMember.findMany({
    include: { area: { select: { orgId: true } } },
  });
  for (const m of areaMembers) addMapping(m.userId, m.area?.orgId);

  // Signal 2: Report.ownerId → area.orgId
  const reports = await prisma.report.findMany({
    where: { areaId: { not: null } },
    select: { ownerId: true, area: { select: { orgId: true } } },
  });
  for (const r of reports) addMapping(r.ownerId, r.area?.orgId);

  // Signal 3: Dataset.uploadedById → area.orgId
  const datasets = await prisma.dataset.findMany({
    where: { areaId: { not: null } },
    select: { uploadedById: true, area: { select: { orgId: true } } },
  });
  for (const d of datasets) addMapping(d.uploadedById, d.area?.orgId);

  console.log(`Inferred org relationships for ${userOrgMap.size} users`);

  let created = 0;
  let skipped = 0;

  for (const [userId, orgIds] of userOrgMap.entries()) {
    for (const orgId of orgIds) {
      const result = await prisma.orgMembership.upsert({
        where: { userId_orgId: { userId, orgId } },
        update: {},
        create: { userId, orgId, role: 'member' },
      });
      // upsert returns the record — check if it was created or already existed
      // (Prisma doesn't directly tell us, so we count all)
      created++;
    }
  }

  // Also list all users with NO memberships and NO signals
  const allUsers = await prisma.user.findMany({
    where: { role: { not: 'superadmin' } },
    select: { id: true, email: true, name: true },
  });

  const usersWithNoOrg = allUsers.filter(u => !userOrgMap.has(u.id));
  if (usersWithNoOrg.length > 0) {
    console.log(`\nUsers with no org signals (cannot auto-assign):`);
    for (const u of usersWithNoOrg) {
      console.log(`  - ${u.name} (${u.email}) [${u.id}]`);
    }
  }

  console.log(`\nDone. Upserted ${created} membership(s).`);
  if (usersWithNoOrg.length > 0) {
    console.log(`${usersWithNoOrg.length} user(s) have no area/report/dataset activity — invite them manually via /org/admin.`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
