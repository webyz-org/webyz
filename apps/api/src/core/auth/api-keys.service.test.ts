import { test } from "node:test";
import assert from "node:assert/strict";

import { API_KEY_PREFIX, bearerApiKey, generateApiKey, hashApiKey, looksLikeApiKey } from "./api-keys.service.js";

test("generated tokens have the prefix, 43 url-safe chars, and a distinct hash", () => {
  const a = generateApiKey();
  const b = generateApiKey();

  assert.ok(a.token.startsWith(API_KEY_PREFIX));
  assert.equal(a.token.length, API_KEY_PREFIX.length + 43);
  assert.ok(looksLikeApiKey(a.token));
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.hash, hashApiKey(a.token));
  assert.equal(a.hash.length, 64);
});

test("the visible prefix never reveals more than the first 12 characters", () => {
  const { token, prefix } = generateApiKey();
  assert.equal(prefix, token.slice(0, 12));
  assert.ok(token.startsWith(prefix));
});

test("looksLikeApiKey rejects anything that is not exactly our token shape", () => {
  assert.equal(looksLikeApiKey(""), false);
  assert.equal(looksLikeApiKey("wbz_"), false);
  assert.equal(looksLikeApiKey("wbz_" + "a".repeat(42)), false);
  assert.equal(looksLikeApiKey("wbz_" + "a".repeat(44)), false);
  assert.equal(looksLikeApiKey("wbz_" + "a".repeat(42) + "="), false);
  assert.equal(looksLikeApiKey("sk_" + "a".repeat(43)), false);
  assert.equal(looksLikeApiKey("wbz_" + "a".repeat(43)), true);
});

test("bearerApiKey extracts our token from an Authorization header and nothing else", () => {
  const { token } = generateApiKey();
  assert.equal(bearerApiKey(`Bearer ${token}`), token);
  assert.equal(bearerApiKey(`bearer ${token}`), token);
  assert.equal(bearerApiKey(`  Bearer   ${token}  `), token);
  assert.equal(bearerApiKey(undefined), null);
  assert.equal(bearerApiKey(""), null);
  assert.equal(bearerApiKey(token), null);
  assert.equal(bearerApiKey("Basic dXNlcjpwYXNz"), null);
  assert.equal(bearerApiKey("Bearer not-a-key"), null);
  assert.equal(bearerApiKey(`Bearer ${token} extra`), null);
});
