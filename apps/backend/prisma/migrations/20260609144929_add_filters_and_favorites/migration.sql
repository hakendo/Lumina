-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "filters" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "UserFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,

    CONSTRAINT "UserFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserFavorite_userId_reportId_key" ON "UserFavorite"("userId", "reportId");

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
