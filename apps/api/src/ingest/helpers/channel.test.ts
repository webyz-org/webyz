import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyChannel } from "./channel.js";

describe("classifyChannel: AI assistants", () => {
  it("groups an assistant referrer as AI Assistants", () => {
    for (const referrerDomain of ["chatgpt.com", "perplexity.ai", "claude.ai", "gemini.google.com"]) {
      assert.equal(classifyChannel({ referrerDomain }), "AI Assistants", referrerDomain);
    }
  });

  it("reads the utm_source ChatGPT appends when there is no referrer", () => {
    assert.equal(classifyChannel({ utmSource: "chatgpt.com" }), "AI Assistants");
    assert.equal(classifyChannel({ utmSource: " ChatGPT.com " }), "AI Assistants");
  });

  it("keeps a paid or declared medium ahead of the assistant", () => {
    assert.equal(classifyChannel({ utmMedium: "cpc", utmSource: "chatgpt.com" }), "Paid Search");
    assert.equal(classifyChannel({ utmMedium: "email", referrerDomain: "claude.ai" }), "Email");
  });

  it("does not take the search engine behind an assistant host", () => {
    assert.equal(classifyChannel({ referrerDomain: "google.com" }), "Organic Search");
    assert.equal(classifyChannel({ referrerDomain: "gemini.google.com" }), "AI Assistants");
  });

  it("leaves unrelated referrers and direct traffic alone", () => {
    assert.equal(classifyChannel({ referrerDomain: "openai.com" }), "Referral");
    assert.equal(classifyChannel({ referrerDomain: "example.com" }), "Referral");
    assert.equal(classifyChannel({}), "Direct");
  });
});

describe("classifyChannel: hosts under a network's domain", () => {
  it("files link redirects and subdomains under the network", () => {
    assert.equal(classifyChannel({ referrerDomain: "lm.facebook.com" }), "Organic Social");
    assert.equal(classifyChannel({ referrerDomain: "l.instagram.com" }), "Organic Social");
    assert.equal(classifyChannel({ referrerDomain: "m.facebook.com" }), "Organic Social");
    assert.equal(classifyChannel({ referrerDomain: "out.reddit.com" }), "Organic Social");
    assert.equal(classifyChannel({ referrerDomain: "news.ycombinator.com" }), "Organic Social");
    assert.equal(classifyChannel({ referrerDomain: "t.co" }), "Organic Social");
    assert.equal(classifyChannel({ referrerDomain: "images.google.com" }), "Organic Search");
    assert.equal(classifyChannel({ referrerDomain: "google.co.in" }), "Organic Search");
    assert.equal(classifyChannel({ referrerDomain: "search.yahoo.co.jp" }), "Organic Search");
  });

  it("does not read a network's name out of someone else's subdomain", () => {
    assert.equal(classifyChannel({ referrerDomain: "x.example.com" }), "Referral");
    assert.equal(classifyChannel({ referrerDomain: "google.example.com" }), "Referral");
    assert.equal(classifyChannel({ referrerDomain: "facebook-clone.io" }), "Referral");
  });

  it("still reads bare utm_source names", () => {
    assert.equal(classifyChannel({ utmSource: "facebook", utmMedium: "post" }), "Organic Social");
    assert.equal(classifyChannel({ utmSource: "google", utmMedium: "" }), "Organic Search");
  });
});
