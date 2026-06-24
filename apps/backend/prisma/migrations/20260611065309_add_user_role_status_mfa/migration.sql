-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaEnforced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user';
