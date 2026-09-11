import axios from "axios";

import {
  EMAIL_FROM,
  IS_PROD,
  RESEND_API_KEY,
  SMTP_URL,
} from "../../config/env.js";
import type { EmailMessage, EmailTransport } from "./types.js";

/**
 * Logs the message instead of sending it. The default in development so the
 * product works with no mail credentials, and password reset links are still
 * usable straight from the server log.
 */
const consoleTransport: EmailTransport = {
  name: "console",
  async send(message) {
    // In production the body would put password-reset and confirmation links
    // into a log that ships to whoever reads logs. Record that a message was
    // dropped and why, nothing more; the operator's fix is RESEND_API_KEY.
    if (IS_PROD) {
      console.warn(
        `[email] not sent (no mail provider configured; set RESEND_API_KEY): "${message.subject}" to ${message.to}`,
      );
      return;
    }
    console.log(
      [
        "",
        "──────── email (not sent, console transport) ────────",
        `to:      ${message.to}`,
        `from:    ${EMAIL_FROM}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "─────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  },
};

/**
 * Resend over plain HTTP. Chosen so email needs no new dependency: axios is
 * already used for the Google OAuth exchange and the MaxMind download.
 */
const resendTransport: EmailTransport = {
  name: "resend",
  async send(message) {
    await axios.post(
      "https://api.resend.com/emails",
      {
        from: EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      },
    );
  },
};

export const selectTransport = (): EmailTransport => {
  if (RESEND_API_KEY) return resendTransport;

  if (SMTP_URL) {
    // Deliberately not implemented: SMTP needs a mail library, and adding one
    // for an unused path is not worth the dependency. Set RESEND_API_KEY, or
    // add a transport here.
    console.warn(
      "[email] SMTP_URL is set but no SMTP transport is implemented; falling back to console",
    );
  }

  return consoleTransport;
};
