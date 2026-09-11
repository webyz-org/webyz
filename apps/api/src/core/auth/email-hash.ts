import crypto from "node:crypto";

/**
 * A stable, one-way fingerprint of an email address for the deleted-accounts
 * tombstone. Lowercased and trimmed so re-registering with different casing
 * still matches; hashed so the tombstone holds no address.
 */
export const hashEmail = (email: string): string =>
  crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
