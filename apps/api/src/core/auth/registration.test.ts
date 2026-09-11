import { test } from "node:test";
import assert from "node:assert/strict";

import { isRegistrationAllowed } from "./registration.js";

test("open registration allows everyone", () => {
  assert.equal(isRegistrationAllowed(true, 0), true);
  assert.equal(isRegistrationAllowed(true, 7), true);
});

test("closed registration allows only the first account", () => {
  assert.equal(isRegistrationAllowed(false, 0), true);
  assert.equal(isRegistrationAllowed(false, 1), false);
  assert.equal(isRegistrationAllowed(false, 40), false);
});
