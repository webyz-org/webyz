-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "base_period_end" TIMESTAMPTZ(6),
ADD COLUMN     "base_period_start" TIMESTAMPTZ(6),
ADD COLUMN     "cancel_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_invoice_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "status" TEXT NOT NULL,
    "billing_reason" TEXT,
    "currency" TEXT NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "amount_paid_cents" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "has_base_line" BOOLEAN NOT NULL DEFAULT false,
    "has_usage_line" BOOLEAN NOT NULL DEFAULT false,
    "usage_units" INTEGER,
    "usage_period_start" TIMESTAMPTZ(6),
    "usage_period_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_provider_invoice_id_key" ON "billing_invoices"("provider_invoice_id");

-- CreateIndex
CREATE INDEX "billing_invoices_subscription_id_created_at_idx" ON "billing_invoices"("subscription_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_invoices_usage_period_start_idx" ON "billing_invoices"("usage_period_start");

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
