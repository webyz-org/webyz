-- CreateTable
CREATE TABLE "search_console_connections" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "property_uri" TEXT,
    "google_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "search_console_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "search_console_connections_website_id_key" ON "search_console_connections"("website_id");

-- AddForeignKey
ALTER TABLE "search_console_connections" ADD CONSTRAINT "search_console_connections_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
