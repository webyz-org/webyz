import { test } from "node:test";
import assert from "node:assert/strict";

import { isConnectivityError } from "./connectivity.js";

const named = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("x"), { name }, extra);

test("prisma initialisation and P1xxx request errors are connectivity", () => {
  assert.equal(isConnectivityError(named("PrismaClientInitializationError")), true);
  assert.equal(isConnectivityError(named("PrismaClientKnownRequestError", { code: "P1001" })), true);
  assert.equal(isConnectivityError(named("PrismaClientKnownRequestError", { code: "P1017" })), true);
});

test("query and schema errors are not", () => {
  assert.equal(isConnectivityError(named("PrismaClientKnownRequestError", { code: "P2022" })), false);
  assert.equal(isConnectivityError(named("PrismaClientValidationError")), false);
  assert.equal(isConnectivityError(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(isConnectivityError(null), false);
  assert.equal(isConnectivityError("nope"), false);
});

test("socket codes and pg messages count, including when wrapped in cause", () => {
  assert.equal(isConnectivityError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" })), true);
  assert.equal(isConnectivityError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isConnectivityError(new Error("timeout expired")), true);
  const wrapped = Object.assign(new Error("adapter failed"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) });
  assert.equal(isConnectivityError(wrapped), true);
});
