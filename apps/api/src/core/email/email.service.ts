import { selectTransport } from "./transports.js";
import type { EmailMessage } from "./types.js";

const transport = selectTransport();

export const emailTransportName = () => transport.name;

/**
 * Send an email, never throwing.
 *
 * Every caller is a background job or a flow whose success must not depend on
 * the mail provider: a failed quota warning should not abort the enforcement
 * run, and a failed reset email must not reveal anything to the caller. The
 * boolean says whether it went out.
 */
export const sendEmail = async (message: EmailMessage): Promise<boolean> => {
  try {
    await transport.send(message);
    return true;
  } catch (err) {
    console.error(
      `[email] failed to send "${message.subject}" via ${transport.name}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
};
