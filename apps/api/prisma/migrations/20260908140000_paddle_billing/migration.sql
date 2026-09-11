-- Paddle replaces Stripe as the billing provider.
--
-- Nothing was ever sold through Stripe on any installation (no price ids were
-- seeded, `pricingFinal` is false and the keys were never set), so the
-- provider columns are renamed to neutral names and the Stripe-only ones are
-- dropped rather than migrated. Paddle has no metered prices and no
-- provider-side schedule for an item change, which is why the metered price,
-- the subscription item ids and the schedule id all go.

-- users -----------------------------------------------------------------
ALTER TABLE "users" RENAME COLUMN "stripe_customer_id" TO "provider_customer_id";
ALTER INDEX "users_stripe_customer_id_key" RENAME TO "users_provider_customer_id_key";

-- plans -----------------------------------------------------------------
ALTER TABLE "plans" RENAME COLUMN "stripe_price_monthly_id" TO "provider_price_monthly_id";
ALTER TABLE "plans" RENAME COLUMN "stripe_price_yearly_id" TO "provider_price_yearly_id";
ALTER INDEX "plans_stripe_price_monthly_id_key" RENAME TO "plans_provider_price_monthly_id_key";
ALTER INDEX "plans_stripe_price_yearly_id_key" RENAME TO "plans_provider_price_yearly_id_key";
ALTER TABLE "plans" DROP COLUMN "stripe_metered_price_id";

-- subscriptions ---------------------------------------------------------
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_subscription_id" TO "provider_subscription_id";
ALTER INDEX "subscriptions_stripe_subscription_id_key" RENAME TO "subscriptions_provider_subscription_id_key";
ALTER INDEX "subscriptions_stripe_subscription_id_idx" RENAME TO "subscriptions_provider_subscription_id_idx";
ALTER TABLE "subscriptions" DROP COLUMN "stripe_recurring_item_id";
ALTER TABLE "subscriptions" DROP COLUMN "stripe_metered_item_id";
ALTER TABLE "subscriptions" DROP COLUMN "stripe_schedule_id";
-- The pending plan change is now local only, so the job that applies it needs
-- an index to find due rows.
CREATE INDEX "subscriptions_pending_change_at_idx" ON "subscriptions"("pending_change_at");

-- usage_records ---------------------------------------------------------
ALTER TABLE "usage_records" RENAME COLUMN "stripe_usage_record_id" TO "provider_transaction_id";
ALTER TABLE "usage_records" DROP COLUMN "stripe_quantity";
DROP INDEX "usage_records_subscription_id_reported_to_stripe_idx";
DROP INDEX "usage_records_reported_to_stripe_idx";
ALTER TABLE "usage_records" DROP COLUMN "reported_to_stripe";
CREATE INDEX "usage_records_subscription_id_created_at_idx" ON "usage_records"("subscription_id", "created_at");
ALTER TABLE "usage_records" ALTER COLUMN "provider" SET DEFAULT 'paddle';

-- billing_period_usages -------------------------------------------------
DROP INDEX "billing_period_usages_overage_reported_at_idx";
ALTER TABLE "billing_period_usages" DROP COLUMN "overage_reported_at";

-- provider defaults -----------------------------------------------------
ALTER TABLE "billing_events" ALTER COLUMN "provider" SET DEFAULT 'paddle';
ALTER TABLE "billing_invoices" ALTER COLUMN "provider" SET DEFAULT 'paddle';
