-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "slotName" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "DatasetSlotBinding" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "slotName" TEXT NOT NULL,
    "clientDatasetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetSlotBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSlotBinding_reportId_slotName_key" ON "DatasetSlotBinding"("reportId", "slotName");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSlotBinding" ADD CONSTRAINT "DatasetSlotBinding_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSlotBinding" ADD CONSTRAINT "DatasetSlotBinding_clientDatasetId_fkey" FOREIGN KEY ("clientDatasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
