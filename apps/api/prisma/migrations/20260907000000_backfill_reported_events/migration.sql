-- Rows written before the usage ledger reported a period's whole overage in
-- one shot and stamped overage_reported_at. The ledger's delta reporter reads
-- reported_events as its checkpoint, so those rows must carry their overage
-- there or the reporter would send the same overage again. Idempotent: only
-- rows that still show nothing reported are touched.
UPDATE "billing_period_usages"
SET "reported_events" = "overage_events",
    "last_reported_at" = COALESCE("last_reported_at", "overage_reported_at")
WHERE "overage_reported_at" IS NOT NULL
  AND "reported_events" = 0
  AND "overage_events" > 0;
