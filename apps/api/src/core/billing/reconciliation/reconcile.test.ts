import { test } from "node:test";
import assert from "node:assert/strict";

import { compareFigures } from "./reconcile.service.js";

const base = {
  ledgerOverage: 7_100,
  reportedEvents: 7_100,
  chargedEvents: 7_100,
  transactionStatus: "completed",
  // 7,100 events is 8 units of 1,000, rounded up, at 2 cents each.
  invoiceUnits: 8,
  invoiceAmountCents: 16,
  overagePricePer1k: 2,
  billingCycle: "MONTHLY" as const,
  hasBaseLine: true,
  invoiceExpected: true,
};

test("every figure agrees: no findings, units and amount as the charge computed them", () => {
  const r = compareFigures(base);
  assert.deepEqual(r.findings, []);
  assert.equal(r.expectedUnits, 8);
  assert.equal(r.expectedAmountCents, 16);
});

test("each disagreement is named separately", () => {
  assert.match(compareFigures({ ...base, reportedEvents: 7_000, chargedEvents: 7_000 }).findings.join(";"), /under-charged/);
  assert.match(compareFigures({ ...base, reportedEvents: 7_200, chargedEvents: 7_200 }).findings.join(";"), /over-charged/);
  assert.match(compareFigures({ ...base, chargedEvents: 6_000 }).findings.join(";"), /charge records total 6000 plus 0 waived, checkpoint 7100/);
  assert.match(compareFigures({ ...base, chargedEvents: null }).findings.join(";"), /checkpoint moved with no charge record/);
  assert.match(compareFigures({ ...base, transactionStatus: "past_due" }).findings.join(";"), /charge transaction is past_due/);
  assert.match(compareFigures({ ...base, invoiceUnits: 6 }).findings.join(";"), /invoice units 6 differ from expected 8/);
  assert.match(compareFigures({ ...base, invoiceAmountCents: 14 }).findings.join(";"), /invoice amount 14c differs from expected 16c/);
  assert.match(compareFigures({ ...base, invoiceUnits: null, invoiceAmountCents: null }).findings.join(";"), /no usage line/);
});

test("a monthly customer's renewal invoice carries the base; an annual customer's must not", () => {
  assert.deepEqual(compareFigures(base).findings, []);
  assert.match(compareFigures({ ...base, billingCycle: "YEARLY" }).findings.join(";"), /annual customer: base line present/);
  assert.deepEqual(compareFigures({ ...base, billingCycle: "YEARLY", hasBaseLine: false }).findings, []);
});

test("no invoice is not a finding until one is expected, and an unread transaction is tolerated", () => {
  const r = compareFigures({
    ...base,
    invoiceUnits: null,
    invoiceAmountCents: null,
    invoiceExpected: false,
    transactionStatus: null,
  });
  assert.deepEqual(r.findings, []);
});

test("a plan that no longer bills overage has no expected amount", () => {
  const r = compareFigures({ ...base, overagePricePer1k: null, invoiceAmountCents: null });
  assert.equal(r.expectedAmountCents, null);
  assert.equal(r.expectedUnits, 8);
});

test("a waived period explains its checkpoint without a transaction or invoice", () => {
  const r = compareFigures({
    ...base,
    ledgerOverage: 2_300,
    reportedEvents: 2_300,
    chargedEvents: null,
    waivedEvents: 2_300,
    transactionStatus: null,
    invoiceUnits: null,
    invoiceAmountCents: null,
  });
  assert.deepEqual(r.findings, []);
  assert.equal(r.expectedUnits, 0, "nothing was meant to reach an invoice");
});

test("a checkpoint the charges and waivers do not add up to is a finding", () => {
  assert.match(
    compareFigures({ ...base, chargedEvents: 5_000, waivedEvents: 1_000 }).findings.join(";"),
    /charge records total 5000 plus 1000 waived, checkpoint 7100/,
  );
});
