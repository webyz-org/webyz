-- CreateEnum
CREATE TYPE "UsagePeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "UsageReportStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "billing_period_usages" ADD COLUMN     "closed_at" TIMESTAMPTZ(6),
ADD COLUMN     "included_events" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "last_reported_at" TIMESTAMPTZ(6),
ADD COLUMN     "overage_events" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "reported_events" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "spend_cap_triggered_at" TIMESTAMPTZ(6),
ADD COLUMN     "status" "UsagePeriodStatus" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "usage_records" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cumulative_after" BIGINT,
ADD COLUMN     "delta_events" BIGINT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'stripe',
ADD COLUMN     "status" "UsageReportStatus" NOT NULL DEFAULT 'SENT',
ALTER COLUMN "stripe_quantity" DROP NOT NULL;

-- CreateTable
CREATE TABLE "usage_buckets" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "billing_period_usage_id" TEXT NOT NULL,
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'clickhouse',
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_buckets_billing_period_usage_id_idx" ON "usage_buckets"("billing_period_usage_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_buckets_subscription_id_bucket_start_key" ON "usage_buckets"("subscription_id", "bucket_start");

-- CreateIndex
CREATE INDEX "billing_period_usages_status_idx" ON "billing_period_usages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_idempotency_key_key" ON "usage_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "usage_records_status_idx" ON "usage_records"("status");

-- AddForeignKey
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_billing_period_usage_id_fkey" FOREIGN KEY ("billing_period_usage_id") REFERENCES "billing_period_usages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
