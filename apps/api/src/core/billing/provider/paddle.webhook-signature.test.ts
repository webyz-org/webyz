import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { Paddle, Environment } from "@paddle/paddle-node-sdk";

import { PaddleBillingProvider } from "./paddle.provider.js";

/**
 * Webhook signature verification, end to end through the provider.
 *
 * This is the security boundary: anyone can POST to the webhook route, so a
 * body whose HMAC does not match the notification secret must never reach the
 * lifecycle handlers. Verified against the SDK rather than a reimplementation,
 * because the SDK is what runs in production.
 */

const SECRET = "pdl_ntfset_01_test_secret";

const provider = () =>
  new PaddleBillingProvider(new Paddle("pdl_sdbx_apikey_test", { environment: Environment.sandbox }), {
    clientToken: "test_token",
    environment: "sandbox",
  });

const body = JSON.stringify({
  event_id: "evt_01",
  event_type: "subscription.updated",
  occurred_at: "2026-09-06T12:00:00.000Z",
  notification_id: "ntf_01",
  data: { id: "sub_01", status: "active", custom_data: { userId: "u_1" } },
});

/** Paddle signs "<ts>:<raw body>" with the destination's secret. */
const sign = (raw: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) =>
  `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex")}`;

test("a correctly signed body parses into a provider event", async () => {
  const event = await provider().parseWebhook(Buffer.from(body), sign(body), SECRET);
  assert.equal(event.id, "evt_01");
  assert.equal(event.type, "subscription.updated");
  assert.equal(event.createdAt.toISOString(), "2026-09-06T12:00:00.000Z");
  assert.equal((event.data as { id: string }).id, "sub_01");
});

test("a tampered body is refused", async () => {
  const signature = sign(body);
  const tampered = body.replace('"sub_01"', '"sub_attacker"');
  await assert.rejects(() => provider().parseWebhook(Buffer.from(tampered), signature, SECRET));
});

test("a signature from the wrong secret is refused", async () => {
  await assert.rejects(() => provider().parseWebhook(Buffer.from(body), sign(body, "pdl_ntfset_01_other"), SECRET));
});

test("a malformed or missing signature is refused", async () => {
  for (const signature of ["", "garbage", "h1=deadbeef", "ts=abc;h1=deadbeef", "ts=1;h1=nothex"]) {
    await assert.rejects(
      () => provider().parseWebhook(Buffer.from(body), signature, SECRET),
      /malformed/,
      `accepted "${signature}"`,
    );
  }
  // Well formed but ancient: refused for its age, not its shape.
  await assert.rejects(() => provider().parseWebhook(Buffer.from(body), "ts=1;h1=deadbeef", SECRET), /old/);
});

test("an old timestamp is refused, so a captured request cannot be replayed later", async () => {
  const old = Math.floor(Date.now() / 1000) - 3_600;
  await assert.rejects(
    () => provider().parseWebhook(Buffer.from(body), sign(body, SECRET, old), SECRET),
    /3600s old, over the 300s limit/,
  );
});

test("a delivery that took a while still counts: the window is not five seconds", async () => {
  // The provider's own recommendation is 5s, which a retry, a replay or one
  // latency spike would breach, losing a billing event for good.
  const slow = Math.floor(Date.now() / 1000) - 120;
  const event = await provider().parseWebhook(Buffer.from(body), sign(body, SECRET, slow), SECRET);
  assert.equal(event.id, "evt_01");
});

test("a timestamp far in the future points at this server's clock, and says so", async () => {
  const ahead = Math.floor(Date.now() / 1000) + 3_600;
  await assert.rejects(
    () => provider().parseWebhook(Buffer.from(body), sign(body, SECRET, ahead), SECRET),
    /in the future; check this server's clock/,
  );
});

test("the failure says which of the two things is wrong", async () => {
  // A wrong secret and a late delivery are indistinguishable at the endpoint,
  // and need different fixes, so the message has to separate them.
  await assert.rejects(
    () => provider().parseWebhook(Buffer.from(body), sign(body, "pdl_ntfset_01_other"), SECRET),
    /does not match the configured secret/,
  );
  await assert.rejects(() => provider().parseWebhook(Buffer.from(body), sign(body), ""), /secret is not configured/);
});

test("re-serialised JSON does not verify: the raw bytes are what is signed", async () => {
  const signature = sign(body);
  const reserialised = JSON.stringify(JSON.parse(body), null, 2);
  await assert.rejects(() => provider().parseWebhook(Buffer.from(reserialised), signature, SECRET));
});
