-- CreateTable
CREATE TABLE "OrgAuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
