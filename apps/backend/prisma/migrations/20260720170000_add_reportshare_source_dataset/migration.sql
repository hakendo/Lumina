-- ReportShare.sourceDatasetId: dataset (conector DB con conexion propia) cuya
-- connectionString reemplaza la del dataset original al resolver widgets de
-- este reporte para este usuario. Misma query, distinta conexion por cliente.
ALTER TABLE "ReportShare" ADD COLUMN IF NOT EXISTS "sourceDatasetId" TEXT;

ALTER TABLE "ReportShare"
  ADD CONSTRAINT "ReportShare_sourceDatasetId_fkey"
  FOREIGN KEY ("sourceDatasetId") REFERENCES "Dataset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
