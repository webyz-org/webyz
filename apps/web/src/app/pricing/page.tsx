import type { Metadata } from "next";

import SiteHeader from "../../components/marketing/SiteHeader";
import SiteFooter from "../../components/marketing/SiteFooter";
import PlanGrid from "../../components/marketing/PlanGrid";
import { ButtonLink, Ico, SectionHead } from "../../components/marketing/ui";
import { SIGNUP_URL } from "../../config/site";
import { getPlans } from "../../lib/plans";
import { FAQ } from "../../lib/faq";

export const metadata: Metadata = {
  title: "Pricing - Webyz",
  description: "Simple event based pricing. Start free and move up only when you outgrow it.",
};

export default async function PricingPage() {
  const result = await getPlans();
  const plans = result?.plans ?? null;
  const placeholder = result?.pricingStatus !== "final";
  const billing = result?.billing ?? { purchasable: false, trial: null };

  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden">
          <div className="hero-bg absolute inset-0 h-[520px]" aria-hidden />
          <div className="container relative pt-20 sm:pt-24">
            <SectionHead
              align="center"
              size="lg"
              eyebrow="Pricing"
              title={
                <>
                  Simple pricing.
                  <br />
                  Stay in control.
                </>
              }
              text="Pick the plan with the reports and headroom you need. Usage beyond your allowance is billed per thousand events up to a spending cap you set, and the free plan pauses at its limit instead of billing you."
            />
            <div className="mt-14">
              {plans && plans.length > 0 ? (
                <PlanGrid plans={plans} placeholder={placeholder} billing={billing} />
              ) : (
                <div className="rounded-xl border border-border bg-surface p-8 text-center text-[15px] text-muted">
                  Pricing is loading from the API and is unavailable right now. Try again in a moment.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="py-24 lg:py-32">
          <div className="container grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionHead eyebrow="Questions" title="Straight answers." />
            </div>
            <dl className="divide-y divide-border lg:col-span-7 lg:col-start-6">
              {FAQ.map((item) => (
                <div key={item.q} className="py-6 first:pt-0 last:pb-0">
                  <dt className="text-[17px] font-medium text-ink">{item.q}</dt>
                  <dd className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-border bg-bg py-20">
          <div className="container flex flex-col items-center text-center">
            <h2 className="display text-[32px] sm:text-[40px]">Start on the free plan.</h2>
            <p className="mt-4 text-[16px] text-text-secondary">Move up when you outgrow it, not before.</p>
            <ButtonLink href={SIGNUP_URL} size="lg" className="mt-8">
              Start for free
              <Ico name="arrow" className="h-4 w-4" />
            </ButtonLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
