/**
 * The restriction decision table. Every combination the audit flagged as a
 * race between independent writers is a row here: the decision is a pure
 * function of the facts, so no ordering of events can produce a different
 * answer for the same facts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decideRestriction, isQuotaReached, type RestrictionFacts } from "./restriction.js";

const NOW = new Date("2026-09-06T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const payg = (over: Partial<RestrictionFacts> = {}): RestrictionFacts => ({
  status: "ACTIVE",
  graceEndsAt: null,
  isPayg: true,
  capReached: false,
  quotaReached: false,
  ...over,
});
const hardLimit = (over: Partial<RestrictionFacts> = {}): RestrictionFacts => ({
  status: "ACTIVE",
  graceEndsAt: null,
  isPayg: false,
  capReached: false,
  quotaReached: false,
  ...over,
});

test("in good standing, nothing blocks", () => {
  assert.deepEqual(decideRestriction(payg(), NOW), {
    restriction: "NONE",
    blocked: false,
    reasons: { paymentFailed: false, capReached: false, quotaReached: false },
  });
  assert.equal(decideRestriction(hardLimit(), NOW).restriction, "NONE");
});

test("1. spend cap reached and then payment fails: cap holds through grace, non-payment takes over when grace lapses", () => {
  const inGrace = decideRestriction(payg({ capReached: true, status: "PAST_DUE", graceEndsAt: day(14) }), NOW);
  assert.equal(inGrace.restriction, "SPEND_CAP");
  assert.equal(inGrace.blocked, true);

  const lapsed = decideRestriction(payg({ capReached: true, status: "PAST_DUE", graceEndsAt: day(-1) }), NOW);
  assert.equal(lapsed.restriction, "PAYMENT_FAILED");
  assert.equal(lapsed.blocked, true);
  assert.deepEqual(lapsed.reasons, { paymentFailed: true, capReached: true, quotaReached: false });
});

test("2. payment failed past grace, cap raised so it is no longer reached: still blocked for non-payment", () => {
  const d = decideRestriction(payg({ capReached: false, status: "PAST_DUE", graceEndsAt: day(-1) }), NOW);
  assert.equal(d.restriction, "PAYMENT_FAILED");
  assert.equal(d.blocked, true);
});

test("3. payment recovered while the cap is still reached: ingest stays off for the cap", () => {
  const d = decideRestriction(payg({ capReached: true, status: "ACTIVE", graceEndsAt: null }), NOW);
  assert.equal(d.restriction, "SPEND_CAP");
  assert.equal(d.blocked, true);
});

test("4. cap reached while payment grace is still running: the cap blocks, the grace does not", () => {
  const d = decideRestriction(payg({ capReached: true, status: "PAST_DUE", graceEndsAt: day(10) }), NOW);
  assert.equal(d.restriction, "SPEND_CAP");
  assert.deepEqual(d.reasons, { paymentFailed: false, capReached: true, quotaReached: false });
});

test("5. cap reached after grace expired: non-payment outranks the cap", () => {
  const d = decideRestriction(payg({ capReached: true, status: "PAST_DUE", graceEndsAt: day(-3) }), NOW);
  assert.equal(d.restriction, "PAYMENT_FAILED");
});

test("6. a new period with no usage while payment is still failed: remains blocked", () => {
  const d = decideRestriction(payg({ capReached: false, quotaReached: false, status: "UNPAID" }), NOW);
  assert.equal(d.restriction, "PAYMENT_FAILED");
  assert.equal(d.blocked, true);
});

test("7. raising the cap while inside grace lifts the cap block; raising it after grace does not", () => {
  const inside = decideRestriction(payg({ capReached: false, status: "PAST_DUE", graceEndsAt: day(5) }), NOW);
  assert.equal(inside.restriction, "NONE");
  assert.equal(inside.blocked, false);
  const after = decideRestriction(payg({ capReached: false, status: "PAST_DUE", graceEndsAt: day(-5) }), NOW);
  assert.equal(after.restriction, "PAYMENT_FAILED");
});

test("8. payment recovered after a cap restriction with the cap no longer reached: everything lifts", () => {
  const d = decideRestriction(payg({ capReached: false, status: "ACTIVE" }), NOW);
  assert.equal(d.restriction, "NONE");
  assert.equal(d.blocked, false);
});

test("9. the decision is a pure function: repeated evaluation never changes it", () => {
  const facts = payg({ capReached: true, status: "PAST_DUE", graceEndsAt: day(-1) });
  const first = decideRestriction(facts, NOW);
  for (let i = 0; i < 5; i++) assert.deepEqual(decideRestriction(facts, NOW), first);
});

test("10. the order in which facts became true is irrelevant: only the facts matter", () => {
  // Build the same fact set through different sequences of partial updates.
  const sequences: Partial<RestrictionFacts>[][] = [
    [{ capReached: true }, { status: "PAST_DUE", graceEndsAt: day(-1) }],
    [{ status: "PAST_DUE", graceEndsAt: day(-1) }, { capReached: true }],
    [{ status: "PAST_DUE", graceEndsAt: day(14) }, { capReached: true }, { graceEndsAt: day(-1) }],
  ];
  const results = sequences.map((steps) => decideRestriction(steps.reduce<RestrictionFacts>((f, s) => ({ ...f, ...s }), payg()), NOW));
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal(results[0].restriction, "PAYMENT_FAILED");
});

test("UNPAID blocks regardless of any grace deadline; PAST_DUE with no deadline recorded stays in grace", () => {
  assert.equal(decideRestriction(payg({ status: "UNPAID", graceEndsAt: day(30) }), NOW).restriction, "PAYMENT_FAILED");
  assert.equal(decideRestriction(payg({ status: "PAST_DUE", graceEndsAt: null }), NOW).restriction, "NONE");
});

test("grace lapses exactly at the deadline, not before", () => {
  assert.equal(decideRestriction(payg({ status: "PAST_DUE", graceEndsAt: new Date(NOW.getTime() + 1) }), NOW).restriction, "NONE");
  assert.equal(decideRestriction(payg({ status: "PAST_DUE", graceEndsAt: NOW }), NOW).restriction, "PAYMENT_FAILED");
});

test("hard-limit plans: the quota blocks; the cap never applies to them; non-payment still outranks", () => {
  assert.equal(decideRestriction(hardLimit({ quotaReached: true }), NOW).restriction, "FREE_QUOTA");
  assert.equal(decideRestriction(hardLimit({ quotaReached: true, capReached: true }), NOW).restriction, "FREE_QUOTA");
  assert.equal(decideRestriction(hardLimit({ quotaReached: true, status: "UNPAID" }), NOW).restriction, "PAYMENT_FAILED");
  // A pay-as-you-go plan is never quota-blocked: overage is billed instead.
  assert.equal(decideRestriction(payg({ quotaReached: true }), NOW).restriction, "NONE");
});

test("a trial is a hard-limit plan: its allowance blocks like Free", () => {
  assert.equal(decideRestriction(hardLimit({ status: "TRIALING", quotaReached: true }), NOW).restriction, "FREE_QUOTA");
  assert.equal(decideRestriction(hardLimit({ status: "TRIALING" }), NOW).restriction, "NONE");
});

test("quota arithmetic: reached at the allowance, a zero allowance blocks on the first event", () => {
  assert.equal(isQuotaReached(9_999, 10_000), false);
  assert.equal(isQuotaReached(10_000, 10_000), true);
  assert.equal(isQuotaReached(0, 0), false);
  assert.equal(isQuotaReached(1, 0), true);
});
