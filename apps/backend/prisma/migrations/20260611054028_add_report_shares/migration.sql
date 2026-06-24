-- CreateTable
CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_reportId_userId_key" ON "ReportShare"("reportId", "userId");

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
