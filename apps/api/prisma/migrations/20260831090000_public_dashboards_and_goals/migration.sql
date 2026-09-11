-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "public_slug" TEXT;

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_name" TEXT,
    "page_path" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_website_id_idx" ON "goals"("website_id");

-- CreateIndex
CREATE UNIQUE INDEX "goals_website_id_name_key" ON "goals"("website_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "websites_public_slug_key" ON "websites"("public_slug");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

