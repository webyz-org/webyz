import { APP_URL } from "../../../config/env.js";
import type { EmailMessage } from "../types.js";

const layout = (title: string, body: string) => `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8f9fa;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0d1117">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="margin:0 0 20px;font-size:18px;font-weight:600">Webyz</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${title}</h1>
      ${body}
    </div>
  </body>
</html>`;

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#0d1117;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:500">${label}</a></p>`;

const paragraph = (text: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4b5563">${text}</p>`;

const formatCount = (n: number) => n.toLocaleString("en-US");

export const passwordResetEmail = (
  to: string,
  resetUrl: string,
  expiryMinutes: number,
): EmailMessage => ({
  to,
  subject: "Reset your Webyz password",
  text: [
    "Someone asked to reset the password on your Webyz account.",
    "",
    `Open this link to choose a new one. It expires in ${expiryMinutes} minutes and can only be used once:`,
    resetUrl,
    "",
    "If this was not you, ignore this email. Your password stays as it is.",
  ].join("\n"),
  html: layout(
    "Reset your password",
    paragraph("Someone asked to reset the password on your Webyz account.") +
      paragraph(
        `The link below expires in ${expiryMinutes} minutes and can only be used once.`,
      ) +
      button(resetUrl, "Choose a new password") +
      paragraph(
        "If this was not you, ignore this email. Your password stays as it is.",
      ),
  ),
});

export const verifyEmailEmail = (to: string, data: { name: string; url: string; hours: number }): EmailMessage => ({
  to,
  subject: "Confirm your Webyz email address",
  text: [
    `Hi ${data.name},`,
    "",
    `Open this link to confirm your address and start your trial. It expires in ${data.hours} hours and can only be used once:`,
    data.url,
    "",
    "If you did not create a Webyz account, ignore this email and nothing will happen.",
  ].join("\n"),
  html: layout(
    "Confirm your email address",
    paragraph(`Hi ${data.name},`) +
      paragraph(`Confirm your address to sign in and start your trial. The link expires in ${data.hours} hours and can only be used once.`) +
      button(data.url, "Confirm email address") +
      paragraph("If you did not create a Webyz account, ignore this email and nothing will happen."),
  ),
});

export const passwordChangedEmail = (to: string): EmailMessage => ({
  to,
  subject: "Your Webyz password was changed",
  text: [
    "Your Webyz password was just changed, and every other signed-in device has been logged out.",
    "",
    "If this was not you, reset your password immediately:",
    `${APP_URL}/forgot-password`,
  ].join("\n"),
  html: layout(
    "Your password was changed",
    paragraph(
      "Your Webyz password was just changed, and every other signed-in device has been logged out.",
    ) +
      paragraph("If this was not you, reset it immediately.") +
      button(`${APP_URL}/forgot-password`, "Reset password"),
  ),
});

export const accountDeletedEmail = (to: string, data: { name: string }): EmailMessage => ({
  to,
  subject: "Your Webyz account has been deleted",
  text: [
    `Hi ${data.name},`,
    "",
    "Your Webyz account, its websites and all of their analytics data have been deleted, and any subscription has been cancelled.",
    "Invoices already issued remain available from the payment provider for as long as tax law requires.",
    "",
    "If you did not request this, reply to this email straight away.",
  ].join("\n"),
  html: layout(
    "Your account has been deleted",
    paragraph(`Hi ${data.name},`) +
      paragraph(
        "Your Webyz account, its websites and all of their analytics data have been deleted, and any subscription has been cancelled.",
      ) +
      paragraph("Invoices already issued remain available from the payment provider for as long as tax law requires.") +
      paragraph("If you did not request this, reply to this email straight away."),
  ),
});

export const limitWarningEmail = (
  to: string,
  data: {
    name: string;
    planName: string;
    totalEvents: number;
    eventLimit: number;
    thresholdPercent: number;
    isPayg: boolean;
  },
): EmailMessage => {
  const used = `${formatCount(data.totalEvents)} of ${formatCount(data.eventLimit)}`;

  const consequence = data.isPayg
    ? "Traffic keeps being recorded. Anything above your included events is billed as overage on your next invoice."
    : "When you reach the limit, tracking pauses until your billing period resets.";

  return {
    to,
    subject: `You have used ${data.thresholdPercent}% of your Webyz events`,
    text: [
      `Hi ${data.name},`,
      "",
      `You have used ${used} events included in your ${data.planName} plan this period.`,
      "",
      consequence,
      "",
      `Manage your plan: ${APP_URL}/settings/billing`,
    ].join("\n"),
    html: layout(
      `You have used ${data.thresholdPercent}% of your events`,
      paragraph(`Hi ${data.name},`) +
        paragraph(
          `You have used <strong>${used}</strong> events included in your ${data.planName} plan this period.`,
        ) +
        paragraph(consequence) +
        button(`${APP_URL}/settings/billing`, "Manage plan"),
    ),
  };
};

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export const trialStartedEmail = (
  to: string,
  data: { name: string; planName: string; days: number; endsAt: Date; includedEvents: number; sites: number },
): EmailMessage => ({
  to,
  subject: `Your ${data.days}-day Webyz ${data.planName} trial has started`,
  text: [
    `Hi ${data.name},`,
    "",
    `For the next ${data.days} days you have the full ${data.planName} plan: ${formatCount(data.includedEvents)} events, up to ${data.sites} websites, and every report.`,
    "",
    `The trial ends on ${formatDate(data.endsAt)}. No card is needed and nothing is charged. When it ends your account moves to the Free plan unless you choose a paid one. Your data stays either way.`,
    "",
    `See your usage: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    `Your ${data.planName} trial has started`,
    paragraph(`Hi ${data.name},`) +
      paragraph(
        `For the next <strong>${data.days} days</strong> you have the full ${data.planName} plan: ${formatCount(data.includedEvents)} events, up to ${data.sites} websites, and every report.`,
      ) +
      paragraph(
        `The trial ends on <strong>${formatDate(data.endsAt)}</strong>. No card is needed and nothing is charged. When it ends your account moves to the Free plan unless you choose a paid one. Your data stays either way.`,
      ) +
      button(`${APP_URL}/settings/billing`, "See your usage"),
  ),
});

export const trialReminderEmail = (
  to: string,
  data: { name: string; planName: string; daysLeft: number; endsAt: Date; freeSites: number; freeEvents: number; sitesOverFreeLimit: number },
): EmailMessage => {
  const consequence =
    data.sitesOverFreeLimit > 0
      ? `The Free plan includes ${data.freeSites} website${data.freeSites === 1 ? "" : "s"} and ${formatCount(data.freeEvents)} events a month. You have ${data.sitesOverFreeLimit} more site${data.sitesOverFreeLimit === 1 ? "" : "s"} than that; they would stop collecting new data but keep their history.`
      : `The Free plan includes ${data.freeSites} website${data.freeSites === 1 ? "" : "s"} and ${formatCount(data.freeEvents)} events a month. Your data is kept whatever you decide.`;
  return {
    to,
    subject: `${data.daysLeft} days left on your Webyz ${data.planName} trial`,
    text: [
      `Hi ${data.name},`,
      "",
      `Your ${data.planName} trial ends on ${formatDate(data.endsAt)}, in ${data.daysLeft} days.`,
      "",
      `After that your account moves to the Free plan unless you pick a paid plan. ${consequence}`,
      "",
      `Choose a plan: ${APP_URL}/settings/billing`,
    ].join("\n"),
    html: layout(
      `${data.daysLeft} days left on your trial`,
      paragraph(`Hi ${data.name},`) +
        paragraph(`Your ${data.planName} trial ends on <strong>${formatDate(data.endsAt)}</strong>, in ${data.daysLeft} days.`) +
        paragraph(`After that your account moves to the Free plan unless you pick a paid plan. ${consequence}`) +
        button(`${APP_URL}/settings/billing`, "Choose a plan"),
    ),
  };
};

export const trialExpiredEmail = (
  to: string,
  data: { name: string; planName: string; freeSites: number; freeEvents: number; restrictedSites: string[] },
): EmailMessage => {
  const restricted = data.restrictedSites.length
    ? `These sites are over the Free plan's ${data.freeSites}-site limit and have stopped collecting new data: ${data.restrictedSites.join(", ")}. Their history is kept, and they resume the moment you upgrade or make them your active site.`
    : "All of your sites keep collecting data.";
  return {
    to,
    subject: `Your Webyz ${data.planName} trial has ended`,
    text: [
      `Hi ${data.name},`,
      "",
      `Your ${data.planName} trial has ended and your account is now on the Free plan: ${data.freeSites} website${data.freeSites === 1 ? "" : "s"}, ${formatCount(data.freeEvents)} events a month, no charges.`,
      "",
      restricted,
      "",
      `Upgrade any time: ${APP_URL}/settings/billing`,
    ].join("\n"),
    html: layout(
      "Your trial has ended",
      paragraph(`Hi ${data.name},`) +
        paragraph(
          `Your ${data.planName} trial has ended and your account is now on the <strong>Free plan</strong>: ${data.freeSites} website${data.freeSites === 1 ? "" : "s"}, ${formatCount(data.freeEvents)} events a month, no charges.`,
        ) +
        paragraph(restricted) +
        button(`${APP_URL}/settings/billing`, "Upgrade"),
    ),
  };
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

export const spendCapApproachingEmail = (
  to: string,
  data: { name: string; planName: string; currentBillCents: number; capCents: number; overageEvents: number },
): EmailMessage => ({
  to,
  subject: `Your Webyz spending is close to your ${money(data.capCents)} cap`,
  text: [
    `Hi ${data.name},`,
    "",
    `This period's charges on your ${data.planName} plan have reached ${money(data.currentBillCents)} against a spending cap of ${money(data.capCents)}. That includes ${formatCount(data.overageEvents)} events beyond your included allowance.`,
    "",
    "If the cap is reached, tracking pauses until the period resets or you raise the cap. Nothing is ever billed above it.",
    "",
    `Adjust your cap: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    "Close to your spending cap",
    paragraph(`Hi ${data.name},`) +
      paragraph(
        `This period's charges on your ${data.planName} plan have reached <strong>${money(data.currentBillCents)}</strong> against a spending cap of <strong>${money(data.capCents)}</strong>. That includes ${formatCount(data.overageEvents)} events beyond your included allowance.`,
      ) +
      paragraph("If the cap is reached, tracking pauses until the period resets or you raise the cap. Nothing is ever billed above it.") +
      button(`${APP_URL}/settings/billing`, "Adjust spending cap"),
  ),
});

export const spendCapReachedEmail = (
  to: string,
  data: { name: string; planName: string; capCents: number; periodEnd: Date },
): EmailMessage => ({
  to,
  subject: "Tracking paused: your Webyz spending cap was reached",
  text: [
    `Hi ${data.name},`,
    "",
    `Your ${data.planName} plan reached the ${money(data.capCents)} spending cap you set, so tracking is paused. You will not be billed above the cap.`,
    "",
    `Tracking resumes automatically when your period resets on ${formatDate(data.periodEnd)}, or immediately if you raise the cap or upgrade. Data already collected is untouched.`,
    "",
    `Raise the cap: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    "Tracking is paused at your spending cap",
    paragraph(`Hi ${data.name},`) +
      paragraph(
        `Your ${data.planName} plan reached the <strong>${money(data.capCents)}</strong> spending cap you set, so tracking is paused. You will not be billed above the cap.`,
      ) +
      paragraph(
        `Tracking resumes automatically when your period resets on ${formatDate(data.periodEnd)}, or immediately if you raise the cap or upgrade. Data already collected is untouched.`,
      ) +
      button(`${APP_URL}/settings/billing`, "Raise spending cap"),
  ),
});

const cycleWord = (c: "MONTHLY" | "YEARLY") => (c === "YEARLY" ? "billed yearly" : "billed monthly");

export const planChangeScheduledEmail = (
  to: string,
  data: { name: string; fromPlan: string; toPlan: string; toCycle: "MONTHLY" | "YEARLY"; effectiveAt: Date },
): EmailMessage => ({
  to,
  subject: `Your Webyz plan changes to ${data.toPlan} on ${formatDate(data.effectiveAt)}`,
  text: [
    `Hi ${data.name},`,
    "",
    `Your plan will move from ${data.fromPlan} to ${data.toPlan} (${cycleWord(data.toCycle)}) on ${formatDate(data.effectiveAt)}, when your current period ends. Until then nothing changes and you keep what you have paid for.`,
    "",
    "Changed your mind? You can keep your current plan from the billing page any time before that date. Your data is kept either way.",
    "",
    `Billing: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    `Plan change scheduled for ${formatDate(data.effectiveAt)}`,
    paragraph(`Hi ${data.name},`) +
      paragraph(
        `Your plan will move from <strong>${data.fromPlan}</strong> to <strong>${data.toPlan}</strong> (${cycleWord(data.toCycle)}) on <strong>${formatDate(data.effectiveAt)}</strong>, when your current period ends. Until then nothing changes and you keep what you have paid for.`,
      ) +
      paragraph("Changed your mind? You can keep your current plan from the billing page any time before that date. Your data is kept either way.") +
      button(`${APP_URL}/settings/billing`, "Billing"),
  ),
});

export const planChangedEmail = (
  to: string,
  data: { name: string; fromPlan: string; toPlan: string; toCycle: "MONTHLY" | "YEARLY"; restrictedSites: string[] },
): EmailMessage => ({
  to,
  subject: `Your Webyz plan is now ${data.toPlan}`,
  text: [
    `Hi ${data.name},`,
    "",
    `Your plan changed from ${data.fromPlan} to ${data.toPlan} (${cycleWord(data.toCycle)}).`,
    "",
    data.restrictedSites.length
      ? `These sites are over the new plan's limit and have stopped collecting new data: ${data.restrictedSites.join(", ")}. Their history is kept, and you can choose which sites stay active from the billing page.`
      : "All of your sites keep collecting data.",
    "",
    `Billing: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    `Your plan is now ${data.toPlan}`,
    paragraph(`Hi ${data.name},`) +
      paragraph(`Your plan changed from <strong>${data.fromPlan}</strong> to <strong>${data.toPlan}</strong> (${cycleWord(data.toCycle)}).`) +
      paragraph(
        data.restrictedSites.length
          ? `These sites are over the new plan's limit and have stopped collecting new data: ${data.restrictedSites.join(", ")}. Their history is kept, and you can choose which sites stay active from the billing page.`
          : "All of your sites keep collecting data.",
      ) +
      button(`${APP_URL}/settings/billing`, "Billing"),
  ),
});

export const cancellationScheduledEmail = (
  to: string,
  data: { name: string; planName: string; accessUntil: Date; fallbackPlan: string },
): EmailMessage => ({
  to,
  subject: `Your Webyz ${data.planName} plan ends on ${formatDate(data.accessUntil)}`,
  text: [
    `Hi ${data.name},`,
    "",
    `Your ${data.planName} plan is set to end on ${formatDate(data.accessUntil)}. You keep full access until then, and nothing more is charged. After that your account moves to the ${data.fallbackPlan} plan and all your data stays.`,
    "",
    "Changed your mind? Resume from the billing page any time before that date.",
    "",
    `Billing: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    "Your plan is set to end",
    paragraph(`Hi ${data.name},`) +
      paragraph(
        `Your <strong>${data.planName}</strong> plan is set to end on <strong>${formatDate(data.accessUntil)}</strong>. You keep full access until then, and nothing more is charged. After that your account moves to the ${data.fallbackPlan} plan and all your data stays.`,
      ) +
      paragraph("Changed your mind? Resume from the billing page any time before that date.") +
      button(`${APP_URL}/settings/billing`, "Billing"),
  ),
});

export const paymentFailedEmail = (
  to: string,
  data: { name: string; planName: string; graceEndsAt: Date },
): EmailMessage => ({
  to,
  subject: "Action needed: your Webyz payment did not go through",
  text: [
    `Hi ${data.name},`,
    "",
    `We could not collect payment for your ${data.planName} plan. Your dashboards and tracking continue as normal while we retry.`,
    "",
    `If payment is still outstanding on ${formatDate(data.graceEndsAt)}, tracking pauses until it is settled. Your data and dashboards stay available.`,
    "",
    `Update your payment method: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    "Your payment did not go through",
    paragraph(`Hi ${data.name},`) +
      paragraph(`We could not collect payment for your ${data.planName} plan. Your dashboards and tracking continue as normal while we retry.`) +
      paragraph(
        `If payment is still outstanding on <strong>${formatDate(data.graceEndsAt)}</strong>, tracking pauses until it is settled. Your data and dashboards stay available.`,
      ) +
      button(`${APP_URL}/settings/billing`, "Update payment method"),
  ),
});

export const paymentRecoveredEmail = (to: string, data: { name: string; planName: string }): EmailMessage => ({
  to,
  subject: "Thanks, your Webyz payment went through",
  text: [`Hi ${data.name},`, "", `Payment for your ${data.planName} plan has been received. Everything is back to normal.`, "", `Billing: ${APP_URL}/settings/billing`].join("\n"),
  html: layout(
    "Payment received",
    paragraph(`Hi ${data.name},`) + paragraph(`Payment for your ${data.planName} plan has been received. Everything is back to normal.`) + button(`${APP_URL}/settings/billing`, "Billing"),
  ),
});

export const overQuotaEmail = (
  to: string,
  data: {
    name: string;
    planName: string;
    totalEvents: number;
    eventLimit: number;
  },
): EmailMessage => ({
  to,
  subject: "Tracking paused: Webyz event limit reached",
  text: [
    `Hi ${data.name},`,
    "",
    `Your ${data.planName} plan includes ${formatCount(data.eventLimit)} events per period and you have recorded ${formatCount(data.totalEvents)}.`,
    "",
    "Tracking is paused for your websites until the period resets or you upgrade. Data already collected is untouched.",
    "",
    `Upgrade: ${APP_URL}/settings/billing`,
  ].join("\n"),
  html: layout(
    "Tracking is paused",
    paragraph(`Hi ${data.name},`) +
      paragraph(
        `Your ${data.planName} plan includes <strong>${formatCount(data.eventLimit)}</strong> events per period and you have recorded <strong>${formatCount(data.totalEvents)}</strong>.`,
      ) +
      paragraph(
        "Tracking is paused for your websites until the period resets or you upgrade. Data already collected is untouched.",
      ) +
      button(`${APP_URL}/settings/billing`, "Upgrade plan"),
  ),
});

export const invitationEmail = (
  to: string,
  data: {
    inviterName: string;
    siteName: string;
    siteDomain: string;
    role: "ADMIN" | "VIEWER";
    url: string;
    days: number;
  },
): EmailMessage => {
  const access =
    data.role === "ADMIN"
      ? "manage its settings, goals and sharing as an admin"
      : "view its dashboard";
  return {
    to,
    subject: `${data.inviterName} invited you to ${data.siteName} on Webyz`,
    text: [
      `${data.inviterName} invited you to ${access} of ${data.siteName} (${data.siteDomain}) on Webyz.`,
      "",
      `Open this link to accept. It expires in ${data.days} days and only works for an account signed in as ${to}:`,
      data.url,
      "",
      "If you were not expecting this, ignore this email and nothing will change.",
    ].join("\n"),
    html: layout(
      `You are invited to ${data.siteName}`,
      paragraph(
        `<strong>${data.inviterName}</strong> invited you to ${access} of <strong>${data.siteName}</strong> (${data.siteDomain}) on Webyz.`,
      ) +
        paragraph(
          `The link expires in ${data.days} days and only works for an account signed in as ${to}. If you do not have one yet, sign up with that address first.`,
        ) +
        button(data.url, "Accept invitation") +
        paragraph("If you were not expecting this, ignore this email and nothing will change."),
    ),
  };
};

// ─── Notifications: scheduled reports and traffic alerts ─────────────────────

const formatSeconds = (s: number) => {
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
};

const signedPercent = (change: number) => (change > 0 ? `+${change}%` : `${change}%`);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type ReportStat = {
  name: string;
  /** Display value, already formatted. */
  value: string;
  /** Percentage change against the previous period. */
  change: number;
};

export type ReportRow = { name: string; visitors: number };

export type ReportGoal = { name: string; completions: number; conversion_rate: number };

export type PeriodicReportData = {
  /** "Weekly" or "Monthly". */
  kind: "Weekly" | "Monthly";
  domain: string;
  /** Human period label, e.g. "31 Aug to 6 Sep 2026". */
  periodLabel: string;
  stats: ReportStat[];
  topPages: ReportRow[];
  topSources: ReportRow[];
  goals: ReportGoal[];
  dashboardUrl: string;
  manageUrl: string;
};

/** Format a top-stats row's raw value for a report. */
export const formatReportStatValue = (metric: string, value: number) => {
  if (metric === "bounce_rate") return `${Math.round(value)}%`;
  if (metric === "visit_duration") return formatSeconds(value);
  return formatCount(value);
};

const rowsTable = (title: string, rows: ReportRow[]) => {
  if (!rows.length) return "";
  const body = rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f3f5;font-size:14px;color:#0d1117;word-break:break-all">${escapeHtml(r.name)}</td><td style="padding:6px 0;border-bottom:1px solid #f1f3f5;font-size:14px;color:#4b5563;text-align:right;white-space:nowrap">${formatCount(r.visitors)}</td></tr>`,
    )
    .join("");
  return `<h2 style="margin:24px 0 8px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">${title}</h2><table style="width:100%;border-collapse:collapse">${body}</table>`;
};

const rowsText = (title: string, rows: ReportRow[]) =>
  rows.length
    ? ["", title, ...rows.map((r) => `  ${r.name}: ${formatCount(r.visitors)} ${r.visitors === 1 ? "visitor" : "visitors"}`)]
    : [];

export const periodicReportEmail = (to: string, data: PeriodicReportData): EmailMessage => {
  const statsHtml = data.stats
    .map(
      (s) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f3f5;font-size:14px;color:#4b5563">${escapeHtml(s.name)}</td><td style="padding:8px 0;border-bottom:1px solid #f1f3f5;font-size:15px;font-weight:600;text-align:right">${escapeHtml(s.value)}</td><td style="padding:8px 0 8px 12px;border-bottom:1px solid #f1f3f5;font-size:13px;text-align:right;color:${s.change > 0 ? "#15803d" : s.change < 0 ? "#b91c1c" : "#6b7280"}">${signedPercent(s.change)}</td></tr>`,
    )
    .join("");

  const goalsHtml = data.goals.length
    ? `<h2 style="margin:24px 0 8px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Goal conversions</h2><table style="width:100%;border-collapse:collapse">${data.goals
        .map(
          (g) =>
            `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f3f5;font-size:14px">${escapeHtml(g.name)}</td><td style="padding:6px 0;border-bottom:1px solid #f1f3f5;font-size:14px;color:#4b5563;text-align:right;white-space:nowrap">${formatCount(g.completions)} (${g.conversion_rate}%)</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const title = `${data.kind} report for ${data.domain}`;

  return {
    to,
    subject: `${title}: ${data.periodLabel}`,
    text: [
      `${title}`,
      data.periodLabel,
      "",
      ...data.stats.map((s) => `${s.name}: ${s.value} (${signedPercent(s.change)} vs previous period)`),
      ...rowsText("Top pages", data.topPages),
      ...rowsText("Top sources", data.topSources),
      ...(data.goals.length
        ? ["", "Goal conversions", ...data.goals.map((g) => `  ${g.name}: ${formatCount(g.completions)} (${g.conversion_rate}%)`)]
        : []),
      "",
      `Open the dashboard: ${data.dashboardUrl}`,
      `Manage these emails: ${data.manageUrl}`,
    ].join("\n"),
    html: layout(
      title,
      paragraph(`${escapeHtml(data.periodLabel)}, compared with the period before.`) +
        `<table style="width:100%;border-collapse:collapse">${statsHtml}</table>` +
        rowsTable("Top pages", data.topPages) +
        rowsTable("Top sources", data.topSources) +
        goalsHtml +
        button(data.dashboardUrl, "Open dashboard") +
        `<p style="margin:0;font-size:12px;color:#9ca3af"><a href="${data.manageUrl}" style="color:#6b7280">Manage these emails</a></p>`,
    ),
  };
};

export const trafficSpikeEmail = (
  to: string,
  data: { domain: string; visitors: number; threshold: number; realtimeUrl: string; manageUrl: string },
): EmailMessage => ({
  to,
  subject: `Traffic spike on ${data.domain}: ${formatCount(data.visitors)} visitors right now`,
  text: [
    `${data.domain} has ${formatCount(data.visitors)} visitors right now, above your threshold of ${formatCount(data.threshold)}.`,
    "",
    `See what they are doing: ${data.realtimeUrl}`,
    "",
    "You will not get another alert for this site for 12 hours.",
    `Manage these emails: ${data.manageUrl}`,
  ].join("\n"),
  html: layout(
    `Traffic spike on ${escapeHtml(data.domain)}`,
    paragraph(
      `<strong>${escapeHtml(data.domain)}</strong> has <strong>${formatCount(data.visitors)}</strong> visitors right now, above your threshold of ${formatCount(data.threshold)}.`,
    ) +
      button(data.realtimeUrl, "See realtime") +
      paragraph("You will not get another alert for this site for 12 hours.") +
      `<p style="margin:0;font-size:12px;color:#9ca3af"><a href="${data.manageUrl}" style="color:#6b7280">Manage these emails</a></p>`,
  ),
});
