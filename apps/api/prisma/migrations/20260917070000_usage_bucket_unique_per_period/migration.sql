-- Usage buckets are unique per period, not per subscription.
--
-- A period rarely starts on the hour, so the clock hour containing
-- `period_start` is shared with the period before it: each period owns the
-- part of that hour inside its own window. Keying the bucket on
-- (subscription_id, bucket_start) let the two periods collide on that one
-- hour, so the aggregation job dropped the partial hour instead, losing
-- everything from `period_start` to the end of that hour from every period's
-- total.
--
-- The new key is a relaxation: within a period `bucket_start` was already
-- unique, because it was unique across the whole subscription. No existing row
-- can conflict, so no data is rewritten here.

DROP INDEX "usage_buckets_subscription_id_bucket_start_key";

CREATE UNIQUE INDEX "usage_buckets_billing_period_usage_id_bucket_start_key"
  ON "usage_buckets"("billing_period_usage_id", "bucket_start");

-- (subscription_id, bucket_start) was also the only index on subscription_id.
-- Keep a plain one so lookups by subscription stay cheap.
CREATE INDEX "usage_buckets_subscription_id_idx" ON "usage_buckets"("subscription_id");

-- usage_buckets_billing_period_usage_id_idx is now redundant: the new unique
-- index has billing_period_usage_id as its leading column.
DROP INDEX "usage_buckets_billing_period_usage_id_idx";
