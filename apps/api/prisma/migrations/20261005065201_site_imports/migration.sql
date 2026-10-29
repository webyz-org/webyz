-- CreateEnum
CREATE TYPE "SiteImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "site_imports" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ga4',
    "property_id" TEXT NOT NULL,
    "property_name" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "SiteImportStatus" NOT NULL DEFAULT 'PENDING',
    "refresh_token" TEXT,
    "steps_done" INTEGER NOT NULL DEFAULT 0,
    "steps_total" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "heartbeat_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_imports_website_id_idx" ON "site_imports"("website_id");

-- CreateIndex
CREATE INDEX "site_imports_status_idx" ON "site_imports"("status");

-- AddForeignKey
ALTER TABLE "site_imports" ADD CONSTRAINT "site_imports_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
