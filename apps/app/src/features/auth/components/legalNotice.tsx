import type { ReactNode } from "react";

import { MARKETING_URL } from "../../../config/env";

/**
 * The terms and privacy sentence under the auth forms. The documents are pages
 * on the marketing site, so with no marketing site there is nothing to link
 * to and the sentence is omitted; a self-hoster's own terms are their own.
 */
export function legalNotice(action: string): ReactNode | undefined {
  if (!MARKETING_URL) return undefined;
  return (
    <>
      By {action} you agree to our{" "}
      <a href={`${MARKETING_URL}/terms`} className="underline hover:text-text-primary">
        terms of service
      </a>{" "}
      and acknowledge the{" "}
      <a href={`${MARKETING_URL}/privacy`} className="underline hover:text-text-primary">
        privacy policy
      </a>
      .
    </>
  );
}
