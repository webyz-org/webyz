import type { AppContext } from "../../../lib/context.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { sendEmail } from "../../email/email.service.js";
import type { EmailMessage } from "../../email/types.js";

/**
 * Exactly-once billing notifications.
 *
 * The (subscription, kind, scopeKey) row is claimed before the email is sent,
 * so a job that crashes after sending cannot send again, and two instances
 * cannot both send. If the mail provider refuses the message the claim is
 * released again, so the next run of the same idempotent job (hourly at most)
 * retries it: a payment-failed or cap-reached notice that never went out must
 * not be recorded as delivered. `sendEmail` never throws, so "refused" is the
 * only failure mode here.
 */
export type NotificationKind =
  | "trial_started"
  | "trial_reminder_7d"
  | "trial_reminder_3d"
  | "trial_expired"
  | "usage_80"
  | "usage_90"
  | "usage_100"
  | "overage_started"
  | "spend_cap_approaching"
  | "spend_cap_reached"
  | "payment_failed"
  | "payment_recovered"
  | "subscription_canceled"
  | "subscription_changed";

export const notifyOnce = async (
  { prisma }: Pick<AppContext, "prisma">,
  input: { subscriptionId: string; kind: NotificationKind; scopeKey: string; message: EmailMessage },
): Promise<"sent" | "duplicate" | "failed"> => {
  try {
    await prisma.billingNotification.create({
      data: { subscriptionId: input.subscriptionId, kind: input.kind, scopeKey: input.scopeKey, delivered: false },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    throw err;
  }

  const delivered = await sendEmail(input.message);
  if (delivered) {
    await prisma.billingNotification.update({
      where: { subscriptionId_kind_scopeKey: { subscriptionId: input.subscriptionId, kind: input.kind, scopeKey: input.scopeKey } },
      data: { delivered: true },
    });
    return "sent";
  }
  await prisma.billingNotification
    .delete({ where: { subscriptionId_kind_scopeKey: { subscriptionId: input.subscriptionId, kind: input.kind, scopeKey: input.scopeKey } } })
    .catch(() => {});
  console.error(`[notify] ${input.kind} for subscription ${input.subscriptionId} was not delivered; will retry on the next run`);
  return "failed";
};
