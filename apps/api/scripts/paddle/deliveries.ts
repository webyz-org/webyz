/**
 * What the provider tried to deliver, and a way to make it try again.
 *
 *   npx tsx scripts/paddle/deliveries.ts                      # list recent deliveries
 *   npx tsx scripts/paddle/deliveries.ts --logs ntf_...       # attempts for one
 *   npx tsx scripts/paddle/deliveries.ts --replay ntf_...     # replay one
 *   npx tsx scripts/paddle/deliveries.ts --replay-failed      # replay every needs_retry / failed one
 *
 * The first question when a subscription does not appear locally is always
 * "did the webhook arrive". This answers it from the provider's side, which is
 * the only side that knows. Replay is how a delivery lost to a dead tunnel or
 * a restarting API is recovered: the endpoint is idempotent on the event id, so
 * replaying something already processed is a no-op that reports "duplicate".
 */
import "dotenv/config";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("PADDLE_API_KEY is not set.");
  process.exit(2);
}
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const replayOne = arg("--replay");
const replayFailed = process.argv.includes("--replay-failed");
const logsFor = arg("--logs");

const paddle = new Paddle(apiKey, {
  environment: apiKey.includes("sdbx") ? Environment.sandbox : Environment.production,
  logLevel: LogLevel.error,
});

/** Deliveries that never landed. Paddle retries these itself, but slowly. */
const UNDELIVERED = ["needs_retry", "failed"];

const main = async () => {
  if (logsFor) {
    const logs = await paddle.notifications.getLogs(logsFor, { after: "", perPage: 20 }).next();
    console.log(`attempts for ${logsFor}: ${logs.length}`);
    for (const l of logs) console.log(`  ${l.attemptedAt}  HTTP ${l.responseCode}  ${String(l.responseBody).slice(0, 160)}`);
    return;
  }

  if (replayOne) {
    const r = await paddle.notifications.replay(replayOne);
    console.log(`replayed ${replayOne} -> ${r.notificationId ?? "queued"}`);
    return;
  }

  // order_by only accepts id, and ids are sortable, so newest first is id[DESC].
  const page = await paddle.notifications.list({ perPage: 30, orderBy: "id[DESC]" }).next();
  console.log(`deliveries: ${page.length}`);
  for (const n of page) {
    console.log(`  ${n.id}  ${String(n.type).padEnd(26)} ${String(n.status).padEnd(12)} last=${n.lastAttemptAt ?? "-"}`);
  }

  if (replayFailed) {
    const stuck = page.filter((n) => UNDELIVERED.includes(String(n.status)));
    // Oldest first, so the domain sees them in the order they happened. Order
    // does not matter to the handlers, but it makes the logs readable.
    for (const n of [...stuck].reverse()) {
      await paddle.notifications.replay(n.id);
      console.log(`replayed ${n.id} ${n.type}`);
    }
    console.log(`\n${stuck.length} delivery(ies) replayed. Check billing_events for the outcome.`);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
