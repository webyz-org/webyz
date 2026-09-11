-- CreateEnum
CREATE TYPE "SubscriptionRestriction" AS ENUM ('NONE', 'FREE_QUOTA', 'SPEND_CAP', 'PAYMENT_FAILED', 'TRIAL_ENDED');

-- CreateEnum
CREATE TYPE "BillingEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- DropIndex
DROP INDEX "subscriptions_user_id_idx";

-- AlterTable
-- "code" is added nullable, backfilled from the plan name, then made required,
-- because existing rows have no code yet.
ALTER TABLE "plans" ADD COLUMN     "code" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "entitlements" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "overage_price_per_1k" INTEGER,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "spend_cap_default_cents" INTEGER,
ADD COLUMN     "spend_cap_max_cents" INTEGER,
ADD COLUMN     "spend_cap_min_cents" INTEGER;

-- Backfill: code from name, per-1k overage from the per-100k column (rounded
-- up so nobody is under-billed), then enforce NOT NULL. The seed overwrites all
-- of these from the catalog.
UPDATE "plans" SET "code" = lower(regexp_replace("name", '[^A-Za-z0-9]+', '-', 'g')) WHERE "code" IS NULL;
UPDATE "plans" SET "overage_price_per_1k" = CEIL("extra_price_per_100k" / 100.0) WHERE "extra_price_per_100k" IS NOT NULL;
UPDATE "plans" SET "spend_cap_default_cents" = "monthly_price" * 2, "spend_cap_min_cents" = "monthly_price" WHERE "is_free" = false;
ALTER TABLE "plans" ALTER COLUMN "code" SET NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "grace_ends_at" TIMESTAMPTZ(6),
ADD COLUMN     "pending_change_at" TIMESTAMPTZ(6),
ADD COLUMN     "pending_plan_id" TEXT,
ADD COLUMN     "restricted_at" TIMESTAMPTZ(6),
ADD COLUMN     "restriction" "SubscriptionRestriction" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "spend_cap_cents" INTEGER,
ADD COLUMN     "stripe_schedule_id" TEXT,
ADD COLUMN     "trial_starts_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "trial_used_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "restriction_reason" TEXT;

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "type" TEXT NOT NULL,
    "status" "BillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "payload" JSONB,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_events_status_received_at_idx" ON "billing_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "billing_events_type_idx" ON "billing_events"("type");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_trial_ends_at_idx" ON "subscriptions"("trial_ends_at");
