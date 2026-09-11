import { test } from "node:test";
import assert from "node:assert/strict";

import { isBot } from "./bot-detection.js";

const bots = {
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  facebookPreview: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  bingbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  duckduckbot: "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
  yandexbot: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  whatsappPreview: "WhatsApp/2.23.20.0 A",
  lighthouse:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  curl: "curl/8.4.0",
  pythonRequests: "python-requests/2.31",
  headlessChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
  // Not in any database yet, but says what it is.
  uncatalogued: "SomeNewThingBot/1.0 (+https://example.com)",
};

const browsers = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  safariIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // Vendor names that the old regex list treated as crawlers.
  duckduckgoBrowser:
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile DuckDuckGo/5 Safari/537.36",
  facebookInApp:
    "Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.35.108;]",
  googleApp:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 GSA/15.22.30.29.arm64",
  yandexBrowser:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.6.0.0 Safari/537.36",
};

test("crawlers, previewers, CLIs and headless Chrome are bots", () => {
  for (const [name, ua] of Object.entries(bots)) {
    assert.equal(isBot(ua), true, name);
  }
});

test("browsers people use are not, even when a vendor's name is in the string", () => {
  for (const [name, ua] of Object.entries(browsers)) {
    assert.equal(isBot(ua), false, name);
  }
});

test("an empty user agent is not treated as a bot", () => {
  // The pixel fallback and some privacy proxies send none; dropping them
  // would hide real visits, and the data-centre filter still applies.
  assert.equal(isBot(""), false);
});
