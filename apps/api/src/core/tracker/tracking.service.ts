import { updateSession } from "./session.service.js";
import { EventInput, SessionUAInfo } from "./types.js";
import { ClickHouseClient } from "@clickhouse/client";
import { mapEventInputToEventData } from "./event.service.js";
import { insertEvent } from "../../db/clickhouse/event.js";
import { publishRealtimeEvent } from "../realtime/publisher.js";
import { AppContext } from "../../lib/context.js";
import { deriveAccess } from "../billing/state/access-state.js";
import { isConnectivityError } from "./connectivity.js";
import { INGEST_HOSTNAME_CHECK } from "../../config/env.js";
import { hostnameMatchesSite } from "../../utils/hostname.js";

export const track = async (
  deps: { clickhouse: ClickHouseClient },
  input: {
    input: EventInput;
    uaInfo: SessionUAInfo;
    isPageView: boolean;
    newSession: boolean;
  },
) => {
  const event = mapEventInputToEventData(input.input);

  // Store the event
  await insertEvent(deps.clickhouse, event);

  // Fan out to any open Realtime dashboards. Fire-and-forget by design.
  publishRealtimeEvent(event);

  // Update session if it's pageview
  if (input.isPageView) {
    await updateSession(deps.clickhouse, event, input.newSession, input.uaInfo);
  }
};

export type IngestResult =
  | { allowed: true }
  | {
      allowed: false;
      status: 202 | 404 | 429;
      code: "website_not_found" | "quota_exceeded" | "site_inactive" | "payment_required" | "hostname_mismatch";
      message: string;
    };

/**
 * May this site's events be written right now?
 *
 * Three gates, all derived from state the billing domain owns:
 *  1. the site exists;
 *  2. the site is active (a plan with fewer sites than the account has makes
 *     the excess inactive; history is kept, new events are not);
 *  3. the account's access state allows ingest (free quota, spend cap and
 *     payment restrictions all live in `deriveAccess`).
 *
 * `isBlocked` remains as the per-site flag enforcement flips, so a restriction
 * that predates the access-state model still holds.
 *
 * If Postgres is unreachable we fail OPEN: losing a customer's analytics is
 * worse than a few unbilled events. Only unreachable, though: any other error
 * from the lookup is a bug and is rethrown, because failing open on it would
 * silently switch quotas off for every site. See connectivity.ts.
 */
export async function checkIngestAllowed(
  { prisma }: AppContext,
  websiteId: string,
  /** Hostname of the page that sent the event, when the payload had an absolute URL. */
  pageHostname?: string | null,
): Promise<IngestResult> {
  let website: {
    domain: string;
    isBlocked: boolean;
    isActive: boolean;
    user: {
      subscriptions: {
        status: "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING" | "INCOMPLETE" | "UNPAID";
        restriction: "NONE" | "FREE_QUOTA" | "SPEND_CAP" | "PAYMENT_FAILED" | "TRIAL_ENDED";
        trialEndsAt: Date | null;
        graceEndsAt: Date | null;
        providerSubscriptionId: string | null;
        plan: { isFree: boolean };
      }[];
    };
  } | null;

  try {
    website = await prisma.website.findUnique({
      where: { id: websiteId },
      select: {
        domain: true,
        isBlocked: true,
        isActive: true,
        user: {
          select: {
            subscriptions: {
              where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                status: true,
                restriction: true,
                trialEndsAt: true,
                graceEndsAt: true,
                providerSubscriptionId: true,
                plan: { select: { isFree: true } },
              },
            },
          },
        },
      },
    });
  } catch (err) {
    if (!isConnectivityError(err)) throw err;
    console.error("[ingest-guard] Postgres unreachable, failing open:", (err as Error).message);
    return { allowed: true };
  }

  if (!website) {
    return {
      allowed: false,
      status: 404,
      code: "website_not_found",
      message: "Website not found. Check your tracking ID.",
    };
  }

  // A site id is public (it is in the snippet). Events from a page on some
  // other domain are someone else's traffic, or someone's attempt to pollute
  // this site's numbers; drop them quietly. Subdomains and localhost pass.
  if (INGEST_HOSTNAME_CHECK && pageHostname && !hostnameMatchesSite(pageHostname, website.domain)) {
    return {
      allowed: false,
      status: 202,
      code: "hostname_mismatch",
      message: "Event came from a page that does not belong to this site.",
    };
  }

  if (!website.isActive) {
    return {
      allowed: false,
      status: 429,
      code: "site_inactive",
      message: "This website is inactive on your current plan. Make it active or upgrade to resume tracking.",
    };
  }

  const access = deriveAccess(website.user.subscriptions[0] ?? null);
  if (!access.ingestAllowed) {
    const payment = access.reason === "PAYMENT_FAILED";
    return {
      allowed: false,
      status: 429,
      code: payment ? "payment_required" : "quota_exceeded",
      message: payment
        ? "Tracking is paused until the outstanding invoice is paid."
        : "Event allowance reached. Upgrade your plan or raise your spending cap to continue tracking.",
    };
  }

  if (website.isBlocked) {
    return {
      allowed: false,
      status: 429,
      code: "quota_exceeded",
      message: "Monthly event quota reached. Upgrade your plan to continue tracking.",
    };
  }

  return { allowed: true };
}
