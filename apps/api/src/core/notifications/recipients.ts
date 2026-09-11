import { badRequest } from "../../errors/http-errors.js";

export const MAX_RECIPIENTS = 10;

// Deliberately loose: one @, no spaces, a dot in the domain. Real validation
// is the bounce; this only rejects obvious typos before they are stored.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, lowercase, dedupe and bound a recipient list, or fail with 400. */
export const normalizeRecipients = (input: unknown): string[] => {
  if (!Array.isArray(input)) throw badRequest("recipients must be a list of email addresses");

  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") throw badRequest("recipients must be a list of email addresses");
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL.test(email)) {
      throw badRequest(`"${raw.trim()}" is not a valid email address`);
    }
    seen.add(email);
  }

  if (seen.size === 0) throw badRequest("Add at least one recipient");
  if (seen.size > MAX_RECIPIENTS) throw badRequest(`At most ${MAX_RECIPIENTS} recipients`);

  return [...seen];
};
