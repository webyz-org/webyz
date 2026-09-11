-- Overage worth less than the provider's minimum charge (70c USD at Paddle)
-- cannot be billed as its own transaction. Such a period is settled as WAIVED:
-- the checkpoint moves, no transaction exists, and reconciliation knows why.
ALTER TYPE "UsageReportStatus" ADD VALUE 'WAIVED';
