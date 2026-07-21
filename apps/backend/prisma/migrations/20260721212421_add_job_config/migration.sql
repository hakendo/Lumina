-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}';
