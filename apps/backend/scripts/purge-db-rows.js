/**
 * One-time cleanup: deletes all DatasetRow records belonging to 'db' sourceType datasets.
 * DB connector datasets are now live-query; local copies are stale and unused.
 *
 * Usage: DATABASE_URL=... node scripts/purge-db-rows.js [--dry-run]
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const dbDatasets = await prisma.dataset.findMany({
    where: { sourceType: 'db' },
    select: { id: true, name: true },
  });

  if (!dbDatasets.length) {
    console.log('No DB connector datasets found. Nothing to do.');
    return;
  }

  const ids = dbDatasets.map(d => d.id);

  const rowCount = await prisma.datasetRow.count({ where: { datasetId: { in: ids } } });

  console.log(`Found ${dbDatasets.length} DB connector dataset(s), ${rowCount} stored row(s):`);
  for (const d of dbDatasets) {
    const c = await prisma.datasetRow.count({ where: { datasetId: d.id } });
    console.log(`  [${d.id}] "${d.name}" — ${c} rows`);
  }

  if (rowCount === 0) {
    console.log('No rows to delete.');
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would delete ${rowCount} row(s). Pass no flag to execute.`);
    return;
  }

  const { count } = await prisma.datasetRow.deleteMany({ where: { datasetId: { in: ids } } });
  console.log(`\nDeleted ${count} row(s) from DatasetRow.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
