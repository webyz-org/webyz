import type { Metadata } from "next";
import Link from "next/link";

import LegalPage from "../../components/marketing/LegalPage";
import { LEGAL, operatorLine } from "../../lib/legal";

export const metadata: Metadata = {
  title: "Terms of service - Webyz",
  description: "The agreement between Webyz and the people who create accounts and install it on their websites.",
};

const li = "list-disc space-y-1.5 pl-5";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={
        <>
          <p>
            These terms are the agreement between you and {operatorLine()} (&quot;Webyz&quot;,
            &quot;we&quot;) for the use of the Webyz analytics service. By creating an account or installing the
            script you accept them. If you are acting for a company, you confirm you may bind it.
          </p>
          <p>
            Webyz is in <strong>beta</strong>. It works, it is measured and billed as described here, and it will
            change. Section 7 says what that means for availability.
          </p>
        </>
      }
      sections={[
        {
          id: "service",
          title: "1. The service",
          body: (
            <>
              <p>
                Webyz gives you a script to place on websites you own or are authorised to measure, and a dashboard
                and API that show what the script collects: traffic, sources, pages, technology, approximate location,
                goals and funnels. What is collected and how it is protected is described in the{" "}
                <Link href="/privacy" className="underline hover:text-ink">
                  privacy policy
                </Link>
                , which forms part of these terms.
              </p>
            </>
          ),
        },
        {
          id: "account",
          title: "2. Your account",
          body: (
            <>
              <ul className={li}>
                <li>You must give accurate details and keep your password and API keys secret.</li>
                <li>You are responsible for everything done with your account and keys.</li>
                <li>One person may hold one free trial. Creating accounts to obtain more is not allowed.</li>
                <li>You must be at least 16, or the age of digital consent where you live if higher.</li>
              </ul>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "3. Acceptable use and your obligations as a website owner",
          body: (
            <>
              <p>You may install Webyz only on websites you own or have permission to measure. You agree to:</p>
              <ul className={li}>
                <li>
                  comply with the privacy and data protection law that applies to you and your visitors, including
                  obtaining any consent your jurisdiction requires and describing your use of Webyz in your own
                  privacy notice;
                </li>
                <li>
                  not send personal data in custom event names or properties. The script collects none by design; what
                  you add is your responsibility;
                </li>
                <li>not use Webyz on sites that are unlawful, or to track people rather than traffic;</li>
                <li>
                  not attack, overload, reverse engineer the hosted service, or bypass plan limits, spending caps or
                  access controls;
                </li>
                <li>not resell the hosted service without our written agreement.</li>
              </ul>
              <p>
                For visitor data collected by the script, you are the controller and we are your processor. We
                process it only to provide the service to you, keep it confidential, protect it with appropriate
                measures, use only the sub-processors listed in the privacy policy, help you respond to visitors&apos;
                requests where we can, and delete it when you delete the website or the account. A separate data
                processing agreement is available on request for customers who need one.
              </p>
            </>
          ),
        },
        {
          id: "plans",
          title: "4. Plans, usage and billing",
          body: (
            <>
              <ul className={li}>
                <li>
                  Plans include a number of events per month across all your websites. The free plan pauses
                  collection when its allowance is reached and never bills you.
                </li>
                <li>
                  Paid plans continue collecting past the allowance and bill the excess per thousand events at the
                  rate shown for your plan, up to a monthly spending cap you set. When the cap is reached, collection
                  pauses until the next period or until you raise the cap. Excess worth less than the minimum our
                  payment provider can charge is not billed.
                </li>
                <li>
                  Plans are billed monthly or yearly in advance; usage above the allowance is billed monthly in
                  arrears. Prices are shown before you subscribe and on the pricing page. Taxes are added where
                  applicable.
                </li>
                <li>
                  Upgrades apply immediately with a prorated charge. Downgrades and cancellations take effect at the
                  end of the period you have paid for; you keep access until then. Payments are not refunded except
                  where the law requires or we made a mistake; the{" "}
                  <Link href="/refunds" className="underline hover:text-ink">
                    refund and cancellation policy
                  </Link>{" "}
                  has the detail.
                </li>
                <li>
                  If a payment fails we tell you and keep the service running for a grace period. If it is still
                  unpaid afterwards, collection is paused until the balance is settled. Your data is not deleted for
                  non-payment.
                </li>
                <li>
                  A free trial ends automatically. When it ends, or when you move to a plan that allows fewer websites,
                  the extra websites stop collecting but keep their history; you choose which stay active.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "your-data",
          title: "5. Your data",
          body: (
            <>
              <p>
                The analytics data collected from your websites is yours. You can export it as CSV or read it through
                the API at any time, share a dashboard publicly if you choose, and delete a website and all of its
                data yourself. We use it only to provide the service and to compute aggregate, non-identifying usage
                figures needed to operate it.
              </p>
            </>
          ),
        },
        {
          id: "software",
          title: "6. Software and intellectual property",
          body: (
            <>
              <p>
                The hosted service, its dashboard and its brand remain ours. Where Webyz source code is published under
                an open source licence, that licence governs your use of the code; these terms govern the hosted
                service.
              </p>
            </>
          ),
        },
        {
          id: "availability",
          title: "7. Availability, beta and liability",
          body: (
            <>
              <p>
                The service is provided as is, without warranty. During the beta there is no uptime commitment, and
                features may change or be withdrawn with notice in the product. We aim to announce breaking changes
                to the script and API in advance.
              </p>
              <p>
                To the extent the law allows, we are not liable for indirect or consequential loss, and our total
                liability for any claim is limited to the amount you paid us in the twelve months before the claim.
                Nothing here limits liability that cannot be limited by law.
              </p>
            </>
          ),
        },
        {
          id: "termination",
          title: "8. Ending the agreement",
          body: (
            <>
              <p>
                You may cancel at any time from the billing page; your data is deleted when you delete your account
                or ask us to. We may suspend or end accounts that break these terms, after telling you unless the
                breach is severe or the law prevents notice. If we stop offering the service we give at least thirty
                days&apos; notice and the ability to export your data.
              </p>
            </>
          ),
        },
        {
          id: "law",
          title: "9. Governing law and changes",
          body: (
            <>
              <p>
                These terms are governed by the law of {LEGAL.jurisdiction}, and its courts have jurisdiction, without
                affecting consumer rights that apply where you live.
              </p>
              <p>
                We may update these terms. The date at the top shows the current version; for material changes we
                email account holders before they take effect. Continuing to use the service after that date means you
                accept the new terms.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
