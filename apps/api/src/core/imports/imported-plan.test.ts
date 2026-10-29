import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planImported } from "./imported-plan.js";

const is = (value: string) => ({ op: "is" as const, value });

describe("planImported: which imported rows answer a question", () => {
  it("reads site totals from the visitors family when nothing is filtered", () => {
    assert.deepEqual(planImported(null, {}), { family: "visitors", filters: {}, rateNeutral: false });
  });

  it("answers a breakdown from its own family", () => {
    assert.equal(planImported("utm_campaign", {})?.family, "sources");
    assert.equal(planImported("city", {})?.family, "locations");
    assert.equal(planImported("browser_version", {})?.family, "browsers");
    assert.equal(planImported("page", {})?.family, "pages");
    assert.equal(planImported("outbound_domain", {})?.family, "events");
  });

  it("keeps imported data under filters from the same family, as Plausible does", () => {
    const plan = planImported("utm_campaign", { source: is("google.com") });
    assert.equal(plan?.family, "sources");
    assert.deepEqual(plan?.filters, { source: is("google.com") });
    assert.equal(planImported("region", { country: is("IN") })?.family, "locations");
    assert.equal(planImported(null, { country: is("IN") })?.family, "locations");
    assert.equal(planImported("page", { hostname: is("blog.example.com") })?.family, "pages");
    assert.equal(planImported("outbound_url", { outbound_domain: is("github.com") })?.family, "events");
  });

  it("leaves imported data out when the question spans two families", () => {
    assert.equal(planImported("browser", { country: is("IN") }), null);
    assert.equal(planImported(null, { country: is("IN"), browser: is("Chrome") }), null);
    assert.equal(planImported("page", { source: is("google.com") }), null);
  });

  it("never groups by a filter-only dimension", () => {
    assert.equal(planImported("hostname", {}), null);
  });

  it("marks page and event rows as adding no bounces or visit seconds", () => {
    assert.equal(planImported("page", {})?.rateNeutral, true);
    assert.equal(planImported(null, { event: is("Signup") })?.rateNeutral, true);
    assert.equal(planImported("channel", {})?.rateNeutral, false);
  });

  it("ignores empty filter values", () => {
    assert.equal(planImported("browser", { country: { op: "is", value: "" } })?.family, "browsers");
  });
});
