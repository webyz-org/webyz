-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "WebsiteRole" AS ENUM ('ADMIN', 'VIEWER');

-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "share_password_hash" TEXT;

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_reports" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "recipients" TEXT[],
    "last_period_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_alerts" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "recipients" TEXT[],
    "last_triggered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "traffic_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_members" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WebsiteRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "website_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_invitations" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WebsiteRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segments_website_id_idx" ON "segments"("website_id");

-- CreateIndex
CREATE UNIQUE INDEX "segments_website_id_name_key" ON "segments"("website_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "email_reports_website_id_frequency_key" ON "email_reports"("website_id", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "traffic_alerts_website_id_key" ON "traffic_alerts"("website_id");

-- CreateIndex
CREATE INDEX "website_members_user_id_idx" ON "website_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_members_website_id_user_id_key" ON "website_members"("website_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_invitations_token_hash_key" ON "website_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "website_invitations_expires_at_idx" ON "website_invitations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "website_invitations_website_id_email_key" ON "website_invitations"("website_id", "email");

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_reports" ADD CONSTRAINT "email_reports_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_alerts" ADD CONSTRAINT "traffic_alerts_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_members" ADD CONSTRAINT "website_members_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_members" ADD CONSTRAINT "website_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_invitations" ADD CONSTRAINT "website_invitations_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_invitations" ADD CONSTRAINT "website_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
