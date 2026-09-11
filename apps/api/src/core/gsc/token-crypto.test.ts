import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { decryptWithKey, encryptWithKey, isEncrypted } from "./token-crypto.js";

const key = crypto.randomBytes(32);

test("round trip, with a fresh IV every time", () => {
  const a = encryptWithKey("1//refresh-token", key);
  const b = encryptWithKey("1//refresh-token", key);
  assert.ok(isEncrypted(a));
  assert.notEqual(a, b, "same plaintext must not produce the same ciphertext");
  assert.equal(decryptWithKey(a, key), "1//refresh-token");
  assert.equal(decryptWithKey(b, key), "1//refresh-token");
});

test("a legacy plaintext value passes through unchanged", () => {
  assert.equal(isEncrypted("1//plain"), false);
  assert.equal(decryptWithKey("1//plain", key), "1//plain");
});

test("the wrong key or a tampered value fails closed", () => {
  const stored = encryptWithKey("secret", key);
  assert.throws(() => decryptWithKey(stored, crypto.randomBytes(32)));
  const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "BB" : "AA");
  assert.throws(() => decryptWithKey(tampered, key));
  assert.throws(() => decryptWithKey("enc:v1:broken", key), /Malformed/);
});
