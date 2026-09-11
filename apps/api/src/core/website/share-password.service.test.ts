import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertSharePasswordShape, unlockWithPassword } from "./share-password.service.js";
import { verifyShareToken } from "./share-token.js";

const HASH = "$2b$12$notarealhashbutstableforthetestxxxxxxxxxxxxxxxxxxxxxxxxx";
const site = { id: "site-1", sharePasswordHash: HASH };

const matches = (expected: string) => async (plain: string, hash: string) =>
  plain === expected && hash === HASH;

describe("unlockWithPassword", () => {
  it("issues a token that the site's hash verifies", async () => {
    const result = await unlockWithPassword(site, "correct horse", matches("correct horse"));
    assert.equal(result.expiresIn, 7 * 24 * 60 * 60);
    assert.equal(verifyShareToken(site.id, HASH, result.token), true);
    assert.equal(verifyShareToken("other-site", HASH, result.token), false);
  });

  it("rejects a wrong password with SHARE_PASSWORD_INVALID", async () => {
    await assert.rejects(
      unlockWithPassword(site, "nope", matches("correct horse")),
      (err: { code?: string; statusCode?: number }) =>
        err.code === "SHARE_PASSWORD_INVALID" && err.statusCode === 401,
    );
  });

  it("is a 400 when the dashboard has no password", async () => {
    await assert.rejects(
      unlockWithPassword({ id: "site-2", sharePasswordHash: null }, "anything", matches("anything")),
      (err: { statusCode?: number }) => err.statusCode === 400,
    );
  });

  it("is a 404 when the slug resolves to nothing", async () => {
    await assert.rejects(
      unlockWithPassword(null, "anything", matches("anything")),
      (err: { statusCode?: number }) => err.statusCode === 404,
    );
  });
});

describe("assertSharePasswordShape", () => {
  it("accepts 8 to 128 characters", () => {
    assert.doesNotThrow(() => assertSharePasswordShape("12345678"));
    assert.doesNotThrow(() => assertSharePasswordShape("x".repeat(128)));
  });

  it("rejects too short and too long", () => {
    assert.throws(() => assertSharePasswordShape("1234567"));
    assert.throws(() => assertSharePasswordShape("x".repeat(129)));
  });
});
