import type { Metadata } from "next";
import Link from "next/link";

import LegalPage from "../../components/marketing/LegalPage";
import { LEGAL } from "../../lib/legal";

export const metadata: Metadata = {
  title: "Refund and cancellation policy - Webyz",
  description: "How cancelling works, what happens to your data, and when a payment is refunded.",
};

const li = "list-disc space-y-1.5 pl-5";

/**
 * The refund and cancellation terms, on their own page because payment
 * providers and their verification teams look for one. Everything here
 * restates sections 4 and 8 of the terms; a change to either must be made in
 * both.
 */
export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund and cancellation policy"
      intro={
        <p>
          This page sets out how cancelling a Webyz plan works and when a payment is refunded. It forms part of the{" "}
          <Link href="/terms" className="underline hover:text-ink">
            terms of service
          </Link>
          .
        </p>
      }
      sections={[
        {
          id: "cancel",
          title: "1. Cancelling",
          body: (
            <ul className={li}>
              <li>You can cancel at any time from the billing page in your account. No email, no call, no notice period.</li>
              <li>
                Cancellation takes effect at the end of the period you have already paid for. You keep every feature of
                your plan until then, and you can resume before then with one click.
              </li>
              <li>
                When the paid period ends you move to the free plan. Your websites and their history are kept; if you
                have more websites than the free plan allows, the extra ones stop collecting new data but nothing is
                deleted.
              </li>
              <li>Deleting your account deletes everything, immediately and permanently, and ends any subscription.</li>
            </ul>
          ),
        },
        {
          id: "refunds",
          title: "2. Refunds",
          body: (
            <ul className={li}>
              <li>
                Plans are billed in advance and are not refunded for the unused part of a period, whether you cancel,
                downgrade or stop using the service. The free plan and the free trial exist so that you can evaluate
                Webyz without paying first.
              </li>
              <li>
                Downgrading to a cheaper plan takes effect at the end of the current period, so you are never charged
                for a plan you did not receive. Upgrading is charged pro rata for the remainder of the period.
              </li>
              <li>
                Usage above your plan&apos;s allowance is billed after the period ends, for what was actually recorded.
                Excess worth less than the minimum our payment provider can charge is not billed at all.
              </li>
              <li>
                We refund in full where the law of your country requires it, and where we made a mistake: a charge you
                did not authorise, a duplicate charge, or an outage that made the product unusable for a substantial
                part of a period. Write to us within 30 days of the charge.
              </li>
            </ul>
          ),
        },
        {
          id: "how",
          title: "3. How payments and refunds are handled",
          body: (
            <>
              <p>
                Payments are taken by Paddle, our merchant of record. Paddle issues the invoice, charges any applicable
                tax and processes refunds back to the original payment method, usually within 5 to 10 working days of
                approval. Your receipts and payment method are available from the billing page.
              </p>
              <p>
                To ask for a refund, email{" "}
                <a href={`mailto:${LEGAL.contactEmail}`} className="underline hover:text-ink">
                  {LEGAL.contactEmail}
                </a>{" "}
                from the address on your account, with the invoice number. We answer within two working days.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
