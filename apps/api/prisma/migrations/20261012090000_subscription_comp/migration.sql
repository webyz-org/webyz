-- Operator comp on a local-only paid subscription.
--
-- A paid plan with no provider subscription is treated as a hard limit,
-- because overage cannot be billed without a card. That is right for a trial
-- and wrong for a plan an operator gives away: the account is blocked at the
-- allowance like Free. `comped_at` marks the row as deliberately unmetered.
-- Both columns are nullable and default to null, so no existing row changes.

ALTER TABLE "subscriptions" ADD COLUMN "comped_at" TIMESTAMPTZ(6),
ADD COLUMN "comp_note" TEXT;
