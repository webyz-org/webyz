/**
 * Seeds a demo website ("acme.example") with ~6 weeks of plausible-looking
 * traffic so the dashboard has something worth screenshotting and demoing.
 *
 * - Creates/updates the Postgres Website row under the first user.
 * - Inserts sessions and events into ClickHouse. Each session is written
 *   exactly once with its final values, so the ReplacingMergeTree and the
 *   hourly_aggregates MV both see it a single time.
 * - Re-running deletes the demo site's ClickHouse rows first, so it is
 *   idempotent. Only the demo domain is ever touched.
 */
import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "../../src/generated/prisma/client.js";

const DEMO_DOMAIN = "acme.example";
const DAYS = 70;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: "webyz_analytics",
});

/** Deterministic PRNG so re-seeding produces the same shape. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);

const pick = <T>(weighted: [T, number][]): T => {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
};

const randint = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));

// referrer -> channel is derived by ingest/helpers/channel.ts; these referrers
// reproduce the same channel mix a real site would show.
const TRAFFIC: [
  { referrer: string; utmSource?: string; utmMedium?: string; channel: string },
  number,
][] = [
  [{ referrer: "google.com", channel: "Organic Search" }, 34],
  [{ referrer: "", channel: "Direct" }, 26],
  [{ referrer: "bing.com", channel: "Organic Search" }, 4],
  [{ referrer: "duckduckgo.com", channel: "Organic Search" }, 3],
  [{ referrer: "twitter.com", channel: "Organic Social" }, 7],
  [{ referrer: "reddit.com", channel: "Organic Social" }, 6],
  [{ referrer: "news.ycombinator.com", channel: "Organic Social" }, 4],
  [{ referrer: "linkedin.com", channel: "Organic Social" }, 3],
  [{ referrer: "github.com", channel: "Referral" }, 5],
  [{ referrer: "producthunt.com", channel: "Referral" }, 3],
  [
    {
      referrer: "",
      utmSource: "newsletter",
      utmMedium: "email",
      channel: "Email",
    },
    5,
  ],
];

const PAGES: [{ path: string; title: string }, number][] = [
  [{ path: "/", title: "Acme - build faster" }, 32],
  [{ path: "/pricing", title: "Pricing - Acme" }, 16],
  [{ path: "/blog/launch-week", title: "Launch week - Acme blog" }, 13],
  [{ path: "/docs", title: "Documentation - Acme" }, 11],
  [{ path: "/docs/getting-started", title: "Getting started - Acme" }, 9],
  [{ path: "/blog/how-we-ship", title: "How we ship - Acme blog" }, 8],
  [{ path: "/changelog", title: "Changelog - Acme" }, 6],
  [{ path: "/about", title: "About - Acme" }, 5],
];

// Families as the ingest normaliser writes them (utils/ua-normalizer), so
// seeded rows land in the same breakdown buckets as live traffic.
const BROWSERS: [{ family: string; version: string }, number][] = [
  [{ family: "Chrome", version: "128" }, 48],
  [{ family: "Safari", version: "17.5" }, 30],
  [{ family: "Firefox", version: "129" }, 12],
  [{ family: "Microsoft Edge", version: "128" }, 10],
];

const DEVICES: [string, number][] = [
  ["desktop", 62],
  ["mobile", 33],
  ["tablet", 5],
];

const OS_BY_DEVICE: Record<string, [{ family: string; version: string }, number][]> = {
  desktop: [
    [{ family: "macOS", version: "14.6" }, 42],
    [{ family: "Windows", version: "11" }, 44],
    [{ family: "Linux", version: "" }, 14],
  ],
  mobile: [
    [{ family: "iOS", version: "17.5" }, 48],
    [{ family: "Android", version: "14" }, 52],
  ],
  tablet: [
    [{ family: "iOS", version: "17.5" }, 80],
    [{ family: "Android", version: "14" }, 20],
  ],
};

const GEO: [
  { country: string; region: string; city: string },
  number,
][] = [
  [{ country: "US", region: "California", city: "San Francisco" }, 14],
  [{ country: "US", region: "New York", city: "New York" }, 10],
  [{ country: "US", region: "Texas", city: "Austin" }, 6],
  [{ country: "IN", region: "Karnataka", city: "Bengaluru" }, 9],
  [{ country: "IN", region: "Kerala", city: "Kochi" }, 5],
  [{ country: "GB", region: "England", city: "London" }, 9],
  [{ country: "DE", region: "Berlin", city: "Berlin" }, 7],
  [{ country: "FR", region: "Ile-de-France", city: "Paris" }, 5],
  [{ country: "CA", region: "Ontario", city: "Toronto" }, 5],
  [{ country: "AU", region: "New South Wales", city: "Sydney" }, 4],
  [{ country: "NL", region: "North Holland", city: "Amsterdam" }, 4],
  [{ country: "BR", region: "Sao Paulo", city: "Sao Paulo" }, 3],
  [{ country: "JP", region: "Tokyo", city: "Tokyo" }, 3],
  [{ country: "SE", region: "Stockholm", city: "Stockholm" }, 2],
];

const LANGS: [string, number][] = [
  ["en-US", 45],
  ["en-GB", 12],
  ["de-DE", 8],
  ["fr-FR", 6],
  ["pt-BR", 4],
  ["ja-JP", 3],
  ["en-IN", 10],
  ["nl-NL", 3],
  ["sv-SE", 2],
];

const SCREENS_BY_DEVICE: Record<string, [string, number][]> = {
  desktop: [
    ["1920x1080", 40],
    ["2560x1440", 22],
    ["1512x982", 20],
    ["1440x900", 18],
  ],
  mobile: [
    ["390x844", 45],
    ["412x915", 35],
    ["360x800", 20],
  ],
  tablet: [
    ["820x1180", 60],
    ["1024x1366", 40],
  ],
};

const fmtDateTime = (date: Date) =>
  date.toISOString().slice(0, 19).replace("T", " ");
const fmtDateTime64 = (date: Date) =>
  date.toISOString().slice(0, 23).replace("T", " ");

type SessionRow = Record<string, unknown>;
type EventRow = Record<string, unknown>;

function buildSession(start: Date, sessions: SessionRow[], events: EventRow[]) {
  const sessionId = randomUUID();
  const visitorId = randomUUID();
  const source = pick(TRAFFIC);
  const device = pick(DEVICES);
  const browser = pick(BROWSERS);
  const os = pick(OS_BY_DEVICE[device]);
  const geo = pick(GEO);
  const language = pick(LANGS);
  const screen = pick(SCREENS_BY_DEVICE[device]);

  // ~42% bounce; the rest read 2-7 pages.
  const pageViews = rand() < 0.42 ? 1 : randint(2, 7);
  const converted = rand() < 0.014;
  const totalEvents = pageViews + (converted ? 1 : 0);

  const entry = pick(PAGES);
  let current = entry;
  let cursor = new Date(start);
  let exitPath = entry.path;

  for (let view = 0; view < pageViews; view++) {
    events.push({
      event_id: randomUUID(),
      website_id: WEBSITE_ID,
      session_id: sessionId,
      user_id: visitorId,
      event_type: "pageview",
      event_name: "pageview",
      timestamp: fmtDateTime(cursor),
      url_path: current.path,
      url_query: "",
      referrer_path: "",
      referrer_query: "",
      referrer_domain: view === 0 ? source.referrer : DEMO_DOMAIN,
      page_title: current.title,
      hostname: DEMO_DOMAIN,
      browser: browser.family,
      os: os.family,
      device_type: device,
      screen,
      language,
      country: geo.country,
      sub_division_1: geo.region,
      sub_division_2: "",
      city: geo.city,
      utm_source: view === 0 ? (source.utmSource ?? "") : "",
      utm_medium: view === 0 ? (source.utmMedium ?? "") : "",
      utm_campaign: "",
      utm_content: "",
      utm_term: "",
      "meta.key": [],
      "meta.value": [],
    });
    exitPath = current.path;
    cursor = new Date(cursor.getTime() + randint(15, 220) * 1000);
    current = pick(PAGES);
  }

  if (converted) {
    events.push({
      event_id: randomUUID(),
      website_id: WEBSITE_ID,
      session_id: sessionId,
      user_id: visitorId,
      event_type: "event",
      event_name: "signup",
      timestamp: fmtDateTime(cursor),
      url_path: exitPath,
      url_query: "",
      referrer_path: "",
      referrer_query: "",
      referrer_domain: "",
      page_title: "",
      hostname: DEMO_DOMAIN,
      browser: browser.family,
      os: os.family,
      device_type: device,
      screen,
      language,
      country: geo.country,
      sub_division_1: geo.region,
      sub_division_2: "",
      city: geo.city,
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      utm_content: "",
      utm_term: "",
      "meta.key": ["plan"],
      "meta.value": [rand() < 0.7 ? "growth" : "business"],
    });
  }

  const endTime = pageViews === 1 ? new Date(start) : cursor;
  const duration = Math.floor((endTime.getTime() - start.getTime()) / 1000);

  sessions.push({
    session_id: sessionId,
    website_id: WEBSITE_ID,
    user_id: visitorId,
    start_time: fmtDateTime(start),
    end_time: fmtDateTime(endTime),
    duration_seconds: duration,
    entry_page: entry.path,
    exit_page: exitPath,
    page_views: pageViews,
    events: totalEvents,
    hostname: DEMO_DOMAIN,
    browser_family: browser.family,
    browser_version: browser.version,
    os_family: os.family,
    os_version: os.version,
    device_type: device,
    device_brand: "",
    country: geo.country,
    sub_division_1: geo.region,
    sub_division_2: "",
    city: geo.city,
    channel: source.channel,
    utm_source: source.utmSource ?? "",
    utm_medium: source.utmMedium ?? "",
    utm_campaign: "",
    utm_content: "",
    utm_term: "",
    referrer_domain: source.referrer,
    updated_at: fmtDateTime64(endTime),
  });
}

let WEBSITE_ID = "";

async function insertRows(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 10_000) {
    await clickhouse.insert({
      table,
      values: rows.slice(i, i + 10_000),
      format: "JSONEachRow",
    });
  }
}

async function seed() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user found; sign up once before seeding.");

  const website = await prisma.website.upsert({
    where: { domain: DEMO_DOMAIN },
    update: {},
    create: {
      name: "Acme (demo)",
      domain: DEMO_DOMAIN,
      timezone: "UTC",
      userId: user.id,
    },
  });
  WEBSITE_ID = website.id;
  console.log(`Demo website ${DEMO_DOMAIN} -> ${WEBSITE_ID}`);

  // Idempotency: drop this site's previous demo rows before re-inserting.
  for (const table of ["events", "sessions", "hourly_aggregates"]) {
    await clickhouse.command({
      query: `ALTER TABLE ${table} DELETE WHERE website_id = {id:String}`,
      query_params: { id: WEBSITE_ID },
    });
  }

  await clickhouse.insert({
    table: "websites",
    values: [
      {
        id: WEBSITE_ID,
        domain: DEMO_DOMAIN,
        timezone: "UTC",
        created_at: fmtDateTime(new Date()),
      },
    ],
    format: "JSONEachRow",
  });

  const sessions: SessionRow[] = [];
  const events: EventRow[] = [];
  const now = new Date();

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
    const day = new Date(now.getTime() - daysAgo * 86_400_000);
    const weekday = day.getUTCDay();

    // Slow growth, weekend dip, a launch spike 9 days ago, and noise.
    let visitors = 320 + (DAYS - daysAgo) * 6;
    if (weekday === 0 || weekday === 6) visitors *= 0.62;
    if (daysAgo === 9) visitors *= 2.1;
    if (daysAgo === 8) visitors *= 1.5;
    visitors = Math.round(visitors * (0.88 + rand() * 0.24));

    for (let visit = 0; visit < visitors; visit++) {
      // Hour-of-day curve peaking mid-day UTC.
      const hour = Math.min(
        23,
        Math.max(0, Math.round(13 + (rand() + rand() + rand() - 1.5) * 6)),
      );
      const start = new Date(day);
      start.setUTCHours(hour, randint(0, 59), randint(0, 59), 0);
      // Today gets its full-day volume, but squeezed into the hours that have
      // already passed: future timestamps would satisfy the realtime window's
      // `timestamp >= now() - N minutes` and show hundreds of live visitors.
      if (daysAgo === 0) {
        const dayStart = new Date(day);
        dayStart.setUTCHours(0, 0, 0, 0);
        const span = now.getTime() - 10 * 60_000 - dayStart.getTime();
        if (span <= 0) continue;
        start.setTime(dayStart.getTime() + Math.floor(rand() * span));
      }
      buildSession(start, sessions, events);
    }
  }

  // A handful of sessions in the last few minutes so realtime is alive.
  for (let live = 0; live < 9; live++) {
    const start = new Date(now.getTime() - randint(20, 170) * 1000);
    buildSession(start, sessions, events);
  }

  console.log(`Inserting ${sessions.length} sessions, ${events.length} events`);
  await insertRows("events", events);
  await insertRows("sessions", sessions);

  console.log("Done.");
  await clickhouse.close();
  await prisma.$disconnect();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
