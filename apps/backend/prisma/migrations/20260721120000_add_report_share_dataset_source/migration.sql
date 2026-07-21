-- ReportShareDatasetSource: override de conexion mas fino que
-- ReportShare.sourceDatasetId. En vez de pisar la conexion de TODO el
-- reporte para un cliente, permite pisarla dataset por dataset. Si existe
-- fila para (share, dataset), gana sobre ReportShare.sourceDatasetId.
CREATE TABLE "ReportShareDatasetSource" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceDatasetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShareDatasetSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportShareDatasetSource_shareId_datasetId_key"
  ON "ReportShareDatasetSource"("shareId", "datasetId");

ALTER TABLE "ReportShareDatasetSource"
  ADD CONSTRAINT "ReportShareDatasetSource_shareId_fkey"
  FOREIGN KEY ("shareId") REFERENCES "ReportShare"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportShareDatasetSource"
  ADD CONSTRAINT "ReportShareDatasetSource_datasetId_fkey"
  FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportShareDatasetSource"
  ADD CONSTRAINT "ReportShareDatasetSource_sourceDatasetId_fkey"
  FOREIGN KEY ("sourceDatasetId") REFERENCES "Dataset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
