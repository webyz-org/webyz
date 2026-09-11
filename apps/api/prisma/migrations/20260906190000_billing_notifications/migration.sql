-- CreateTable
CREATE TABLE "billing_notifications" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "billing_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_notifications_kind_sent_at_idx" ON "billing_notifications"("kind", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_notifications_subscription_id_kind_scope_key_key" ON "billing_notifications"("subscription_id", "kind", "scope_key");

-- AddForeignKey
ALTER TABLE "billing_notifications" ADD CONSTRAINT "billing_notifications_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
