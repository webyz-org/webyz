-- CreateEnum
CREATE TYPE "SiteExportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "site_exports" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "filename" TEXT NOT NULL,
    "status" "SiteExportStatus" NOT NULL DEFAULT 'RUNNING',
    "size_bytes" BIGINT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "site_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_exports_website_id_idx" ON "site_exports"("website_id");

-- CreateIndex
CREATE INDEX "site_exports_status_idx" ON "site_exports"("status");

-- AddForeignKey
ALTER TABLE "site_exports" ADD CONSTRAINT "site_exports_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
