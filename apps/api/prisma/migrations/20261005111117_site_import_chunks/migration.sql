-- AlterTable
ALTER TABLE "site_imports" ADD COLUMN     "chunks_done" TEXT[] DEFAULT ARRAY[]::TEXT[];
