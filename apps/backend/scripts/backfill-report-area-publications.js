/**
 * One-time backfill: creates a ReportAreaPublication row for every Report
 * that still has its old (single) areaId set, ahead of dropping that column
 * in favor of multi-area publishing. See the plan for the full migration:
 * add table -> backfill -> drop column, so nothing is lost mid-way.
 *
 * Usage: node scripts/backfill-report-area-publications.js [--dry-run]
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const reports = await prisma.report.findMany({
    where: { areaId: { not: null } },
    select: { id: true, title: true, areaId: true },
  });

  if (!reports.length) {
    console.log('No reports with areaId set — nothing to backfill.');
    return;
  }

  console.log(`${reports.length} report(s) with areaId set.\n`);

  for (const r of reports) {
    console.log(`${r.title} (${r.id}) -> area ${r.areaId}`);
    if (!DRY_RUN) {
      await prisma.reportAreaPublication.upsert({
        where: { reportId_areaId: { reportId: r.id, areaId: r.areaId } },
        update: {},
        create: { reportId: r.id, areaId: r.areaId },
      });
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
