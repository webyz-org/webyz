import { test } from "node:test";
import assert from "node:assert/strict";

import { listEnv } from "./list-env.js";

const fallback = ["https://a.example/list.txt"];

test("unset and empty both give the default, which is what compose passes for an unset variable", () => {
  assert.deepEqual(listEnv(undefined, fallback), fallback);
  assert.deepEqual(listEnv("", fallback), fallback);
  assert.deepEqual(listEnv("   ", fallback), fallback);
});

test("off disables explicitly", () => {
  assert.deepEqual(listEnv("off", fallback), []);
  assert.deepEqual(listEnv("NONE", fallback), []);
});

test("a comma list is split and trimmed", () => {
  assert.deepEqual(listEnv(" https://x/1.txt, https://y/2.json ,", fallback), ["https://x/1.txt", "https://y/2.json"]);
});
