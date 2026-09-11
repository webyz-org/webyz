import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isWebsiteRole, normalizeEmail, seatUsage } from "./members.service.js";

describe("team seats", () => {
  it("counts the owner, members and pending invitations against the plan limit", () => {
    assert.deepEqual(seatUsage({ limit: 5, members: 2, pendingInvitations: 1 }), {
      limit: 5,
      used: 4,
      available: 1,
    });
  });

  it("leaves no seat on a single-seat plan", () => {
    assert.equal(seatUsage({ limit: 1, members: 0, pendingInvitations: 0 }).available, 0);
  });

  it("never reports negative availability after a downgrade", () => {
    assert.equal(seatUsage({ limit: 1, members: 4, pendingInvitations: 0 }).available, 0);
  });
});

describe("invitation input", () => {
  it("normalises the address", () => {
    assert.equal(normalizeEmail("  Someone@Example.COM "), "someone@example.com");
  });

  it("rejects a non-address", () => {
    assert.throws(() => normalizeEmail("not an email"), /not a valid email/);
  });

  it("accepts only the two roles", () => {
    assert.ok(isWebsiteRole("ADMIN"));
    assert.ok(isWebsiteRole("VIEWER"));
    assert.ok(!isWebsiteRole("OWNER"));
    assert.ok(!isWebsiteRole(1));
  });
});
