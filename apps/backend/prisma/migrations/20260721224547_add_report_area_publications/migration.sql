-- CreateTable
CREATE TABLE "ReportAreaPublication" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAreaPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportAreaPublication_reportId_areaId_key" ON "ReportAreaPublication"("reportId", "areaId");

-- AddForeignKey
ALTER TABLE "ReportAreaPublication" ADD CONSTRAINT "ReportAreaPublication_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAreaPublication" ADD CONSTRAINT "ReportAreaPublication_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
