/**
 * AI assistants that send visitors to a site, matched on the referrer host
 * (stored without `www.`) or on a `utm_source` the assistant appends itself
 * (ChatGPT tags its links `utm_source=chatgpt.com`, so app clicks with no
 * referrer still land here).
 *
 * Exact hosts, not suffixes: `google.com` is search and `gemini.google.com`
 * is an assistant, so a suffix rule would need exceptions. The same list is
 * inlined into the dashboard's channel expression (`db/clickhouse/filters.ts`)
 * so sessions recorded before the channel existed are regrouped on read; add
 * a host here and both ingest and old rows pick it up.
 */
export const AI_ASSISTANT_CHANNEL = "AI Assistants";

export const AI_ASSISTANT_HOSTS: readonly string[] = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "chat.deepseek.com",
  "grok.com",
  "meta.ai",
  "chat.mistral.ai",
  "poe.com",
  "you.com",
  "phind.com",
  "duck.ai",
  "chat.qwen.ai",
];

const HOSTS = new Set(AI_ASSISTANT_HOSTS);

export const isAiAssistant = (hostOrSource: string): boolean =>
  HOSTS.has(hostOrSource.trim().toLowerCase().replace(/^www\./, ""));
