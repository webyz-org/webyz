-- CreateTable
CREATE TABLE "deleted_accounts" (
    "id" TEXT NOT NULL,
    "email_hash" TEXT NOT NULL,
    "trial_used_at" TIMESTAMPTZ(6),
    "had_paid_subscription" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deleted_accounts_email_hash_key" ON "deleted_accounts"("email_hash");
