-- CreateTable
CREATE TABLE "funnels" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_steps" (
    "id" TEXT NOT NULL,
    "funnel_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "event_name" TEXT,
    "page_path" TEXT,

    CONSTRAINT "funnel_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnels_website_id_idx" ON "funnels"("website_id");

-- CreateIndex
CREATE UNIQUE INDEX "funnels_website_id_name_key" ON "funnels"("website_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_steps_funnel_id_position_key" ON "funnel_steps"("funnel_id", "position");

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_steps" ADD CONSTRAINT "funnel_steps_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
