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
