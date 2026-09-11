import type { Metadata } from "next";

import LegalPage from "../../components/marketing/LegalPage";
import { LEGAL, operatorLine } from "../../lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy - Webyz",
  description:
    "What Webyz collects about account holders and about visitors of the websites it measures, how long it is kept, and how to exercise your rights.",
};

const li = "list-disc space-y-1.5 pl-5";

/**
 * Every statement here is checked against the code it describes, with the file
 * named in a comment so the next change to that file prompts an edit here.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <>
          <p>
            Webyz is a web analytics service operated by {operatorLine()} (&quot;we&quot;). This
            policy covers two different groups of people, because we hold different roles for each.
          </p>
          <ul className={li}>
            <li>
              <strong>Account holders</strong>: people who sign up and add their websites. We decide how their
              account data is used, so we are the controller.
            </li>
            <li>
              <strong>Visitors</strong>: people who browse a website that has the Webyz script installed. The
              website owner decides to measure their site and is the controller; we process the visitor data on the
              owner&apos;s behalf and on their instructions.
            </li>
          </ul>
          <p>
            Questions and requests go to{" "}
            <a href={`mailto:${LEGAL.contactEmail}`} className="underline hover:text-ink">
              {LEGAL.contactEmail}
            </a>
            .
          </p>
        </>
      }
      sections={[
        {
          id: "visitors",
          title: "1. Visitors of websites that use Webyz",
          body: (
            <>
              <p>
                The Webyz script is designed so that a website can be measured without identifying the people who
                visit it. Concretely, for each page view or custom event it records:
              </p>
              {/* apps/api/public/js/script.js payload, ingest/normalize/normalize-tracking.ts */}
              <ul className={li}>
                <li>the page URL and title, and the referring URL when the browser provides one;</li>
                <li>the browser, operating system and device type, derived from the user agent string;</li>
                <li>screen size and browser language;</li>
                <li>how long the page was visible in the browser tab and how far down it was scrolled;</li>
                <li>the country, region and city derived from the IP address (see below);</li>
                <li>
                  custom events and their properties, when the website owner has chosen to send them. Owners are
                  responsible for not sending personal data in event properties.
                </li>
              </ul>
              <p>
                <strong>No cookies and no browser storage.</strong> The script sets no cookies and writes nothing to
                the browser. The one exception is an opt-out flag stored in the browser only if the visitor
                deliberately opts out, so that the choice can be remembered.
              </p>
              {/* apps/api/src/ingest/identity/visitor-identity.ts */}
              <p>
                <strong>How visitors are counted.</strong> To tell one visitor from another within a day, the server
                computes a hash of the website, the IP address, the user agent and a random value that changes every
                day (UTC). The random value is discarded after two days. Because it changes daily, the identifier for
                the same person is different every day and cannot be linked across days, and the hash cannot be
                reversed to recover the IP address. A visit is counted as one session until thirty minutes pass
                without activity.
              </p>
              <p>
                <strong>IP addresses are not stored.</strong> The IP address is used twice, in memory, and then
                discarded: as an input to the daily hash above, and to look up an approximate location in a
                geolocation database that runs on our own servers. No IP address is written to our analytics
                database or sent to a third party.
              </p>
              {/* script.js respectDNT default, isOptedOut; utils/bot-detection.ts */}
              <p>
                <strong>Do Not Track and opt-out.</strong> The script honours the browser&apos;s Do Not Track setting
                by default and records nothing when it is on. Any visitor can also opt out of measurement on a given
                site by calling the script&apos;s opt-out function from the browser console; the website owner may
                expose this as a button. Known bots and crawlers are dropped before they are counted, as are requests
                from known data-centre and hosting address ranges, which is how scripted browsers reach a site; that
                check also uses the IP address in memory only.
              </p>
              <p>
                <strong>Legal basis and your rights.</strong> The website owner is responsible for the legal basis of
                measuring their site and for describing it in their own privacy notice. Because we hold no identifier
                that can be tied back to a person, we are unable to find or extract a particular visitor&apos;s data;
                requests about a specific website should go to that website&apos;s owner.
              </p>
            </>
          ),
        },
        {
          id: "accounts",
          title: "2. Account holders",
          body: (
            <>
              {/* prisma/schema.prisma User, Session, ApiKey, SearchConsoleConnection, Subscription */}
              <p>When you create and use an account we process:</p>
              <ul className={li}>
                <li>your name and email address, and a hashed password if you sign up with one;</li>
                <li>
                  if you sign in with Google, the identifier, email address, name and avatar Google returns for your
                  account. We do not receive your Google password;
                </li>
                <li>
                  the IP address and browser of each dashboard sign-in, kept with the session so you can review and
                  revoke your sessions;
                </li>
                <li>the websites you add: their domain, display name and timezone;</li>
                <li>
                  if you connect Google Search Console for a site, the access token Google issues for read-only
                  Search Console access. Search data is fetched live and cached for ten minutes, never stored;
                </li>
                <li>
                  if you create API keys, a name you give each key and a hash of the key itself. The key is shown to
                  you once and is not stored in a form we can read;
                </li>
                <li>
                  plan, subscription and usage records, and the identifiers our payment provider assigns to you. We
                  never see or store card numbers.
                </li>
              </ul>
              <p>
                We use this data to run your account, meter usage against your plan, bill you, secure your account and
                send you service email (password resets, usage warnings, billing notices). We do not sell it and we
                do not use it for advertising.
              </p>
              {/* core/email/templates */}
              <p>
                The legal basis is the contract with you for the service and, for security and abuse prevention, our
                legitimate interest in keeping the service safe.
              </p>
            </>
          ),
        },
        {
          id: "cookies",
          title: "3. Cookies we set",
          body: (
            <>
              {/* config/constants.ts SESSION_COOKIE_NAME, SESSION_TTL_MS; core/auth/helper.ts */}
              <p>
                <strong>Websites measured by Webyz</strong>: none. See section 1.
              </p>
              <p>
                <strong>This marketing website</strong>: none. Fonts are served from our own servers and no analytics
                or advertising scripts are loaded.
              </p>
              <p>
                <strong>The Webyz dashboard</strong> (for account holders): one strictly necessary cookie,{" "}
                <code>webyz_session</code>, which keeps you signed in. It lives for thirty days, is renewed while you
                use the dashboard, and is removed when you log out. It is not used for tracking and no consent banner
                is required for it.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "4. How long we keep data",
          body: (
            <>
              {/* core/billing/entitlements/retention.ts is an access rule; website.service deleteWebsite */}
              <p>
                <strong>Analytics data</strong> is kept for as long as the website exists in an account. Each plan
                sets how far back the dashboard and API can look; that limit governs what is shown, and older data
                is deleted when the website is deleted. Deleting a website removes all of its events and sessions.
              </p>
              <p>
                <strong>Account data</strong> is kept while the account exists. Sessions expire after thirty days.
                Password reset links expire after thirty minutes and are purged. Billing records are kept for as long
                as tax and accounting law requires.
              </p>
              {/* core/auth/account.service.ts deleteAccount; DeletedAccount tombstone */}
              <p>
                You can delete your account yourself from Account settings in the dashboard. Deletion cancels any
                subscription, removes the account, its websites and all of their analytics data immediately, and
                keeps only a one-way hash of the email address so that a free trial cannot be claimed again by
                re-registering, plus the billing records we must retain. Invoices already issued remain with the
                payment provider.
              </p>
            </>
          ),
        },
        {
          id: "processors",
          title: "5. Who else sees data",
          body: (
            <>
              <p>We use these providers to run the service. Each receives only what its role requires.</p>
              {/* provider/paddle, core/email/transports (Resend), core/auth/google-auth, core/gsc, geo (MaxMind runs locally) */}
              <ul className={li}>
                <li>{LEGAL.hostingProvider}: hosting for the API, databases and dashboard.</li>
                <li>
                  Paddle: payments for paid plans. Paddle is the seller of record, so it takes the payment, handles
                  tax and issues the invoice; card details go to Paddle and never reach us.
                </li>
                <li>Resend: delivery of service email to account holders.</li>
                <li>
                  Google: sign-in with Google, and Search Console data for sites you choose to connect. Governed by
                  Google&apos;s terms for those APIs.
                </li>
              </ul>
              <p>
                Location lookup uses a geolocation database (MaxMind GeoLite2) that runs on our own servers; no
                visitor data is sent to MaxMind. Public dashboards you choose to share are visible to anyone with the
                link. Data exports and API keys you create are under your control.
              </p>
            </>
          ),
        },
        {
          id: "rights",
          title: "6. Your rights",
          body: (
            <>
              <p>
                Depending on where you live you may have the right to access, correct, export or delete personal data
                we hold about you, to object to or restrict processing, and to complain to a supervisory authority.
                Account holders can download a copy of their account data as JSON and their analytics as CSV from
                the dashboard, change their password there, and delete the account there; for anything else,
                email{" "}
                <a href={`mailto:${LEGAL.contactEmail}`} className="underline hover:text-ink">
                  {LEGAL.contactEmail}
                </a>
                . We answer within thirty days.
              </p>
            </>
          ),
        },
        {
          id: "changes",
          title: "7. Changes to this policy",
          body: (
            <p>
              When we change how the service handles data we update this page and the date at the top. For material
              changes affecting account holders we also send an email to the address on the account before they take
              effect.
            </p>
          ),
        },
      ]}
    />
  );
}
