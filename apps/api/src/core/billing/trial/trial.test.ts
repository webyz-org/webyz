import { test } from "node:test";
import assert from "node:assert/strict";

import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { daysRemaining, isRolloutEligible, isTrialEligible, trialEndFor } from "./trial.service.js";

const NOW = new Date("2026-09-06T12:00:00Z");
const day = 86_400_000;

test("eligible once: never trialled and no paid subscription", () => {
  assert.equal(isTrialEligible({ trialUsedAt: null }, false), BILLING_CONFIG.trial.enabled);
  assert.equal(isTrialEligible({ trialUsedAt: NOW }, false), false);
  assert.equal(isTrialEligible({ trialUsedAt: null }, true), false);
});

test("rollout: only accounts created within the configured window", () => {
  const within = new Date(NOW.getTime() - (BILLING_CONFIG.trial.grantToAccountsCreatedWithinDays - 1) * day);
  const older = new Date(NOW.getTime() - (BILLING_CONFIG.trial.grantToAccountsCreatedWithinDays + 1) * day);
  assert.equal(isRolloutEligible({ trialUsedAt: null, createdAt: within }, false, NOW), true);
  assert.equal(isRolloutEligible({ trialUsedAt: null, createdAt: older }, false, NOW), false);
  assert.equal(isRolloutEligible({ trialUsedAt: NOW, createdAt: within }, false, NOW), false);
});

test("trial length and countdown come from the catalog", () => {
  const end = trialEndFor(NOW);
  assert.equal(end.getTime() - NOW.getTime(), BILLING_CONFIG.trial.days * day);
  assert.equal(daysRemaining(end, NOW), BILLING_CONFIG.trial.days);
  assert.equal(daysRemaining(end, new Date(end.getTime() - 1)), 1);
  assert.equal(daysRemaining(end, end), 0);
  assert.equal(daysRemaining(end, new Date(end.getTime() + day)), 0);
});
