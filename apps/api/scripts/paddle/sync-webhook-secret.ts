/**
 * Put the notification destination's secret into apps/api/.env.
 *
 *   npx tsx scripts/paddle/sync-webhook-secret.ts [--url <webhook url>] [--id ntfset_...] [--file <env file>]
 *
 * The secret is the one value in this integration that cannot be copied wrong
 * without every webhook failing, and it is easy to copy the destination's id
 * instead. This fetches it from the provider and writes it straight into the
 * env file. It prints the length and nothing else: the value never reaches a
 * terminal, a log or a transcript.
 *
 * Development convenience. In production the secret belongs in whatever holds
 * the rest of the secrets, and nothing should be writing env files.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

const apiKey = (process.env.PADDLE_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("PADDLE_API_KEY is not set.");
  process.exit(2);
}
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const wantUrl = arg("--url");
const wantId = arg("--id");
/** Which file to write. `.env` in development; the hosted stack passes its own. */
const envPath = resolve(process.cwd(), arg("--file") ?? ".env");

const paddle = new Paddle(apiKey, {
  environment: apiKey.includes("sdbx") ? Environment.sandbox : Environment.production,
  logLevel: LogLevel.error,
});

const KEY = "PADDLE_WEBHOOK_SECRET";

const main = async () => {
  const all = await paddle.notificationSettings.list();
  const active = all.filter((n) => n.active);
  const chosen =
    (wantId ? all.find((n) => n.id === wantId) : undefined) ??
    (wantUrl ? all.find((n) => n.destination === wantUrl) : undefined) ??
    (active.length === 1 ? active[0] : undefined);

  if (!chosen) {
    console.error(
      `Cannot tell which destination to use (${all.length} exist, ${active.length} active). Pass --id or --url:`,
    );
    for (const n of all) console.error(`  ${n.id} ${n.active ? "active" : "inactive"} -> ${n.destination}`);
    process.exit(2);
  }

  const secret = (chosen as unknown as { endpointSecretKey?: string }).endpointSecretKey ?? "";
  if (!secret) {
    console.error(`The provider did not return a secret for ${chosen.id}; copy it from the dashboard by hand.`);
    process.exit(1);
  }

  if (!existsSync(envPath)) {
    console.error(`No env file at ${envPath}. Run this from apps/api, or pass --file.`);
    process.exit(2);
  }

  const before = readFileSync(envPath, "utf8");
  const line = `${KEY}=${secret}`;
  const pattern = new RegExp(`^${KEY}=.*$`, "m");
  const after = pattern.test(before)
    ? before.replace(pattern, line)
    : `${before.replace(/\n*$/, "\n")}${line}\n`;

  if (after === before) {
    console.log(`${KEY} already matches ${chosen.id} (${secret.length} chars). Nothing written.`);
    return;
  }
  writeFileSync(envPath, after);
  console.log(`wrote ${KEY} (${secret.length} chars) for ${chosen.id} -> ${chosen.destination}`);
  console.log(`file: ${envPath}`);
  console.log("Restart the API, or touch a source file if it runs under tsx watch.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
