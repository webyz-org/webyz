import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Runs the real tracker (public/js/script.js) in a fake browser so the
 * engagement arithmetic can be checked without a browser: what the script
 * sends, and when. The environment is the minimum the script touches.
 */
const SCRIPT = readFileSync(path.join(process.cwd(), "public/js/script.js"), "utf8");

type Sent = Record<string, unknown>;

const browser = (
  initial: { focused?: boolean; visibility?: string; attrs?: Record<string, string> } = {},
) => {
  const sent: Sent[] = [];
  const listeners: Record<string, ((e?: unknown) => void)[]> = {};
  const on = (type: string, fn: (e?: unknown) => void) => {
    (listeners[type] ??= []).push(fn);
  };
  const fire = (type: string) => (listeners[type] ?? []).forEach((fn) => fn({ type }));

  let now = 1_000_000;
  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  const state = { focused: initial.focused ?? true, visibility: initial.visibility ?? "visible", scrollY: 0 };
  const attrs: Record<string, string> = {
    "data-site-id": "site-1",
    "data-endpoint": "https://api.example/track",
    ...(initial.attrs ?? {}),
  };

  const document = {
    readyState: "complete",
    title: "Test page",
    referrer: "",
    currentScript: { getAttribute: (n: string) => attrs[n] ?? null },
    querySelector: () => null,
    addEventListener: on,
    get visibilityState() {
      return state.visibility;
    },
    hasFocus: () => state.focused,
    body: { scrollHeight: 3000, offsetHeight: 3000, clientHeight: 800, scrollTop: 0 },
    documentElement: { scrollHeight: 3000, offsetHeight: 3000, clientHeight: 800, scrollTop: 0 },
  };

  const window: Record<string, unknown> = {
    document,
    location: {
      href: "https://example.com/article",
      hostname: "example.com",
      pathname: "/article",
      search: "",
      hash: "",
      origin: "https://example.com",
      protocol: "https:",
    },
    navigator: { userAgent: "Mozilla/5.0 Chrome/128", language: "en-IN" },
    screen: { width: 390, height: 844 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { pushState() {}, replaceState() {} },
    innerHeight: 800,
    get scrollY() {
      return state.scrollY;
    },
    addEventListener: on,
    fetch: (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true });
    },
    Image: class {},
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
    Date: FakeDate,
    Math,
    JSON,
    Object,
    Array,
    Promise,
    String,
    Number,
    Error,
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(SCRIPT, window);

  return {
    sent,
    fire,
    state,
    advance: (ms: number) => {
      now += ms;
    },
    pushState: (path: string) => {
      (window.location as { href: string; pathname: string }).href = `https://example.com${path}`;
      (window.location as { pathname: string }).pathname = path;
      (window.history as { pushState: (a: unknown, b: string, c: string) => void }).pushState({}, "", path);
    },
    settle: () => new Promise((r) => setTimeout(r, 150)),
    location: window.location as { href: string },
    /** A click on an anchor, as the script sees it through event delegation. */
    click: (anchor: { href: string; text?: string; target?: string }, opts: { button?: number } = {}) => {
      const url = new URL(anchor.href);
      const element = {
        href: anchor.href,
        hostname: url.hostname,
        target: anchor.target ?? "",
        textContent: anchor.text ?? "",
        tagName: "A",
        getAttribute: () => null,
        hasAttribute: () => false,
        closest: (selector: string) => (selector === "a[href]" ? element : null),
        attributes: [],
      };
      const event = {
        type: "click",
        button: opts.button ?? 0,
        target: element,
        defaultPrevented: false,
        preventDefault() {
          event.defaultPrevented = true;
        },
      };
      (listeners.click ?? []).forEach((fn) => fn(event));
      return event;
    },
  };
};

test("a pageview is sent on load and engagement starts counting while visible and focused", async () => {
  const b = browser();
  await b.settle();
  assert.equal(b.sent.length, 1);
  assert.equal(b.sent[0].t, "pageview");
  assert.equal(b.sent[0].url, "https://example.com/article");

  // Read for 12 seconds, then switch to another window.
  b.advance(12_000);
  b.state.focused = false;
  b.fire("blur");
  await b.settle();

  assert.equal(b.sent.length, 2);
  const report = b.sent[1];
  assert.equal(report.t, "engagement");
  assert.equal(report.e, 12_000);
  // 800px viewport of a 3000px page, nothing scrolled: 27%.
  assert.equal(report.sd, 27);
  assert.equal(report.url, "https://example.com/article");
  assert.equal(report.pid, b.sent[0].pid);
});

test("time in the background is not counted; the next report carries only new visible time", async () => {
  const b = browser();
  await b.settle();
  b.advance(4_000);
  b.state.focused = false;
  b.fire("blur"); // report 1: 4 s
  b.advance(60_000); // an hour of lunch would be the same
  b.state.focused = true;
  b.fire("focus");
  b.advance(5_000);
  b.state.visibility = "hidden";
  b.fire("visibilitychange"); // report 2: 5 s, not 69
  await b.settle();

  const reports = b.sent.filter((s) => s.t === "engagement");
  assert.deepEqual(
    reports.map((r) => r.e),
    [4_000, 5_000],
  );
});

test("nothing is reported when there is nothing new: under three seconds and no deeper scroll", async () => {
  const b = browser();
  await b.settle();
  b.advance(1_000);
  b.state.focused = false;
  b.fire("blur"); // first report always goes out: it carries the initial scroll depth
  b.state.focused = true;
  b.fire("focus");
  b.advance(1_000);
  b.state.focused = false;
  b.fire("blur"); // 1 s and same depth: nothing to say
  await b.settle();
  assert.equal(b.sent.filter((s) => s.t === "engagement").length, 1);
});

test("a deeper scroll is reported even with little time, and depth is the maximum seen", async () => {
  const b = browser();
  await b.settle();
  b.advance(500);
  b.state.focused = false;
  b.fire("blur"); // report 1, 27%
  b.state.focused = true;
  b.fire("focus");
  b.state.scrollY = 2200; // bottom of the 3000px page
  b.fire("scroll");
  b.state.scrollY = 100;
  b.fire("scroll");
  b.advance(500);
  b.state.focused = false;
  b.fire("blur"); // report 2: deeper, so it is sent despite 0.5 s
  await b.settle();
  const reports = b.sent.filter((s) => s.t === "engagement");
  assert.deepEqual(
    reports.map((r) => r.sd),
    [27, 100],
  );
});

test("a client-side route change reports the page being left, then sends the new pageview", async () => {
  const b = browser();
  await b.settle();
  b.advance(8_000);
  b.pushState("/next");
  await b.settle();

  assert.deepEqual(
    b.sent.map((s) => s.t),
    ["pageview", "engagement", "pageview"],
  );
  assert.equal(b.sent[1].url, "https://example.com/article");
  assert.equal(b.sent[1].e, 8_000);
  assert.equal(b.sent[2].url, "https://example.com/next");
  // The new page's report is tied to the new pageview id.
  b.advance(3_000);
  b.state.focused = false;
  b.fire("blur");
  await b.settle();
  assert.equal(b.sent[3].pid, b.sent[2].pid);
  assert.equal(b.sent[3].e, 3_000);
});

test("a page opened in the background counts nothing until it is looked at", async () => {
  const b = browser({ focused: false, visibility: "hidden" });
  await b.settle(); // pageview sent, timer not running
  b.advance(30_000);
  b.state.visibility = "visible";
  b.state.focused = true;
  b.fire("visibilitychange");
  b.advance(6_000);
  b.state.visibility = "hidden";
  b.fire("visibilitychange");
  await b.settle();
  const reports = b.sent.filter((s) => s.t === "engagement");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].e, 6_000);
});

test("an outbound click stores the destination without its fragment, with the link text, and keeps navigating", async () => {
  const b = browser({ attrs: { "data-outbound-links": "true" } });
  await b.settle();
  const event = b.click({ href: "https://github.com/webyz-org/webyz?tab=readme#install", text: "  View\n source " });
  assert.equal(event.defaultPrevented, true, "navigation is held for the beacon");
  await b.settle();

  const click = b.sent.find((s) => s.name === "Outbound Link: Click");
  assert.ok(click);
  assert.equal(click.href, "https://github.com/webyz-org/webyz?tab=readme");
  assert.equal(click.text, "View source");
  assert.equal(click.url, "https://example.com/article");
  assert.equal(b.location.href, "https://github.com/webyz-org/webyz?tab=readme#install", "the browser is sent to the real href");
});

test("a link that opens elsewhere is counted without touching navigation", async () => {
  const b = browser({ attrs: { "data-outbound-links": "true" } });
  await b.settle();
  const event = b.click({ href: "https://twitter.com/webyz", target: "_blank" });
  assert.equal(event.defaultPrevented, false);
  await b.settle();
  assert.equal(b.sent.filter((s) => s.name === "Outbound Link: Click").length, 1);
  assert.equal(b.location.href, "https://example.com/article");
});

test("data-outbound-ignore keeps listed hosts and wildcard subdomains internal; strip-query drops the query", async () => {
  const b = browser({
    attrs: {
      "data-outbound-links": "true",
      "data-outbound-ignore": "cdn.example.com, *.example.com, partner.test",
      "data-outbound-strip-query": "true",
    },
  });
  await b.settle();
  b.click({ href: "https://cdn.example.com/x", target: "_blank" });
  b.click({ href: "https://docs.example.com/guide", target: "_blank" });
  b.click({ href: "https://partner.test/", target: "_blank" });
  b.click({ href: "https://example.com/internal", target: "_blank" });
  b.click({ href: "https://github.com/webyz-org?ref=site#top", target: "_blank" });
  await b.settle();

  const clicks = b.sent.filter((s) => s.name === "Outbound Link: Click");
  assert.deepEqual(
    clicks.map((c) => c.href),
    ["https://github.com/webyz-org"],
  );
});

test("without data-outbound-links nothing is sent for an external link", async () => {
  const b = browser();
  await b.settle();
  b.click({ href: "https://github.com/webyz-org", target: "_blank" });
  await b.settle();
  assert.equal(b.sent.filter((s) => s.t === "event").length, 0);
});

test("a double-click on one link counts once; the same link later, or another link, counts again", async () => {
  const b = browser({ attrs: { "data-outbound-links": "true" } });
  await b.settle();
  b.click({ href: "https://example.org/a", target: "_blank" });
  b.click({ href: "https://example.org/a", target: "_blank" }); // 0 ms later: a double-click
  b.click({ href: "https://example.org/b", target: "_blank" }); // a different link counts
  b.advance(600);
  b.click({ href: "https://example.org/a", target: "_blank" }); // a deliberate second click
  await b.settle();
  assert.deepEqual(
    b.sent.filter((s) => s.name === "Outbound Link: Click").map((s) => s.href),
    ["https://example.org/a", "https://example.org/b", "https://example.org/a"],
  );
});

test("a file download carries the link text too", async () => {
  const b = browser({ attrs: { "data-file-downloads": "true" } });
  await b.settle();
  b.click({ href: "https://example.com/files/guide.pdf#page=2", text: "Get the guide", target: "_blank" });
  await b.settle();
  const download = b.sent.find((s) => s.name === "File Download");
  assert.ok(download);
  assert.equal(download.href, "https://example.com/files/guide.pdf");
  assert.equal(download.text, "Get the guide");
});
