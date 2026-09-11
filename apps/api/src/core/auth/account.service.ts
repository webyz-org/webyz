import type { AppContext } from "../../lib/context.js";
import { badRequest, notFound, unauthorized } from "../../errors/http-errors.js";
import { createAppError } from "../../errors/app-error.js";
import { verifyPassword } from "./password.service.js";
import { revokeAllSessions } from "./sessions.service.js";
import { hashEmail } from "./email-hash.js";
import { purgeWebsiteAnalytics } from "../../db/clickhouse/website.js";
import { getBillingProvider, hasBillingProvider } from "../billing/provider/index.js";
import { invalidateEntitlements } from "../billing/entitlements/entitlement.service.js";
import { sendEmail } from "../email/email.service.js";
import { accountDeletedEmail } from "../email/templates/index.js";

/**
 * Self-service GDPR: everything an account holds, and the way to end it.
 *
 * Export returns the account's own data as one JSON document. Analytics rows
 * are not inlined: they are exported per site as CSV through the existing
 * export endpoint, which the document points at.
 *
 * Deletion order matters and is deliberate:
 *  1. Verify the caller (password when the account has one).
 *  2. Cancel every provider-backed subscription immediately. If the provider
 *     refuses, nothing is deleted: an account must never disappear while the
 *     provider keeps billing a card for it.
 *  3. Purge analytics in ClickHouse for every site. Best effort per table;
 *     Postgres is the source of truth for whether a site exists.
 *  4. Leave a tombstone (email hash + trial facts) so delete-and-re-register
 *     does not mint another free trial.
 *  5. Clear caches, then delete the user row; Postgres cascades take the
 *     sessions, keys, sites, goals, funnels, subscriptions and usage rows.
 *  6. Confirm by email, best effort.
 */

export const exportAccountData = async (ctx: AppContext, userId: string) => {
  const { prisma } = ctx;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      provider: true,
      avatarUrl: true,
      createdAt: true,
      providerCustomerId: true,
      websites: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          domain: true,
          timezone: true,
          isActive: true,
          isPublic: true,
          createdAt: true,
          goals: { select: { name: true, eventName: true, pagePath: true, createdAt: true } },
          funnels: {
            select: {
              name: true,
              createdAt: true,
              steps: { orderBy: { position: "asc" }, select: { position: true, eventName: true, pagePath: true } },
            },
          },
          searchConsole: { select: { googleEmail: true, propertyUri: true, createdAt: true } },
        },
      },
      subscriptions: {
        orderBy: { createdAt: "asc" },
        select: {
          status: true,
          billingCycle: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          trialStartsAt: true,
          trialEndsAt: true,
          canceledAt: true,
          spendCapCents: true,
          createdAt: true,
          plan: { select: { code: true, name: true } },
        },
      },
      sessions: {
        orderBy: { createdAt: "desc" },
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
      },
      apiKeys: {
        orderBy: { createdAt: "desc" },
        select: { name: true, keyPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
      },
    },
  });
  if (!user) throw notFound("User not found");

  // Invoices live at the provider; include what it returns, or nothing if it
  // is unreachable, rather than failing the whole export.
  let invoices: unknown[] = [];
  if (user.providerCustomerId && hasBillingProvider()) {
    try {
      invoices = await getBillingProvider().listInvoices(user.providerCustomerId, 100);
    } catch {
      invoices = [];
    }
  }

  const { providerCustomerId: _omit, websites, subscriptions, sessions, apiKeys, ...account } = user;

  return {
    format: "webyz-account-export/1",
    exportedAt: new Date().toISOString(),
    account,
    websites,
    subscriptions: subscriptions.map(({ plan, ...s }) => ({ ...s, planCode: plan.code, planName: plan.name })),
    sessions,
    apiKeys,
    invoices,
    analytics: {
      note: "Analytics data is exported per website as CSV, one file per dataset, with the same period and filter parameters the dashboard uses.",
      endpoint: "GET /api/v1/{websiteId}/export?dataset={timeseries|top-pages|browsers|...}&period=all_time",
      websiteIds: websites.map((w) => w.id),
    },
  };
};

const providerRefused = (message: string) =>
  createAppError(
    `Your subscription could not be cancelled with the payment provider (${message}). Nothing was deleted. Try again in a moment or contact support.`,
    { code: "SUBSCRIPTION_CANCEL_FAILED", statusCode: 502 },
  );

export const deleteAccount = async (
  ctx: AppContext,
  userId: string,
  confirmation: { password?: string },
): Promise<{ deleted: true }> => {
  const { prisma, redis, clickhouse } = ctx;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      password: true,
      trialUsedAt: true,
      websites: { select: { id: true } },
      apiKeys: { select: { keyHash: true } },
      subscriptions: {
        where: { providerSubscriptionId: { not: null } },
        select: { id: true, providerSubscriptionId: true, status: true },
      },
    },
  });
  if (!user) throw notFound("User not found");

  // 1. Verify. A password account must present its password; a Google-only
  //    account has none, and the live session is the proof.
  if (user.password) {
    if (!confirmation.password) throw badRequest("Enter your password to delete the account");
    const valid = await verifyPassword(confirmation.password, user.password);
    if (!valid) throw unauthorized("Password is incorrect");
  }

  // 2. Stop billing first, or stop here.
  const live = user.subscriptions.filter((s) => s.status !== "CANCELED" && s.providerSubscriptionId);
  if (live.length > 0) {
    if (!hasBillingProvider()) throw providerRefused("billing provider not configured");
    const provider = getBillingProvider();
    for (const sub of live) {
      try {
        await provider.cancelNow(sub.providerSubscriptionId!);
      } catch (err) {
        throw providerRefused((err as Error).message ?? "unknown error");
      }
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
    }
  }

  // 3. Analytics. Mutations are async in ClickHouse; the rows go shortly after.
  for (const site of user.websites) {
    await purgeWebsiteAnalytics(clickhouse, site.id).catch((err) => {
      console.error(`[delete-account] analytics purge failed for site ${site.id}`, err);
    });
  }

  // 4. Tombstone, so the trial cannot be farmed by deleting and re-registering.
  await prisma.deletedAccount.upsert({
    where: { emailHash: hashEmail(user.email) },
    create: {
      emailHash: hashEmail(user.email),
      trialUsedAt: user.trialUsedAt,
      hadPaidSubscription: user.subscriptions.length > 0,
    },
    update: {
      trialUsedAt: user.trialUsedAt ?? undefined,
      hadPaidSubscription: user.subscriptions.length > 0 ? true : undefined,
      deletedAt: new Date(),
    },
  });

  // 5. Caches, then the row. Cascades remove everything that hangs off it.
  await revokeAllSessions(ctx, userId);
  await invalidateEntitlements(ctx, userId);
  const cacheKeys = [
    ...user.websites.map((w) => `site:${w.id}`),
    ...user.apiKeys.map((k) => `apikey:${k.keyHash}`),
  ];
  if (cacheKeys.length) await redis.del(...cacheKeys).catch(() => {});

  await prisma.user.delete({ where: { id: userId } });

  // 6. Confirmation. The address is the last thing we hold, and only in memory.
  void sendEmail(accountDeletedEmail(user.email, { name: user.name }));

  return { deleted: true };
};
