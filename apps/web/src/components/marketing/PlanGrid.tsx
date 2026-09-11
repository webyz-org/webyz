import { SIGNUP_URL } from "../../config/site";
import { compact, money, type Entitlements, type Plan } from "../../lib/plans";
import { ButtonLink, Ico } from "./ui";

/**
 * Plan cards for /pricing. Every row is read from the plan's entitlements as
 * served by the API, so the page cannot promise a feature the backend gates.
 * The grid takes as many columns as there are plans.
 */

/** Features shown as included / not included rows, in display order. */
const FEATURE_ROWS: { key: keyof Entitlements; label: string }[] = [
  { key: "realtime", label: "Realtime dashboard" },
  { key: "goals", label: "Goals and conversions" },
  { key: "funnels", label: "Funnels" },
  { key: "journeys", label: "User journeys" },
  { key: "search_console", label: "Google Search Console" },
  { key: "public_dashboards", label: "Public dashboards" },
  { key: "exports", label: "CSV export" },
  { key: "api_access", label: "API access" },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const retention = (days: number) =>
  days % 365 === 0 ? plural(days / 365, "year", "years") : `${days} days`;

const planName = (plans: Plan[], code: string) => plans.find((p) => p.code === code)?.name ?? code;

export default function PlanGrid({
  plans,
  placeholder,
  billing,
}: {
  plans: Plan[];
  placeholder: boolean;
  billing: { purchasable: boolean; trial: { days: number; planCode: string } | null };
}) {
  const cols = Math.min(Math.max(plans.length, 1), 4);
  const colsClass =
    cols === 4 ? "lg:grid-cols-4 md:grid-cols-2" : cols === 3 ? "md:grid-cols-3" : cols === 2 ? "md:grid-cols-2" : "";

  // The API decides what is for sale. During the beta nothing is, so the page
  // says what a new account actually gets instead of offering a checkout that
  // would fail; the same code turns into a normal pricing page once the payment
  // provider and the price ids are in place.
  const notice = !billing.purchasable
    ? billing.trial
      ? `Paid plans are not on sale during the beta. Every new account starts with a ${billing.trial.days}-day ${planName(plans, billing.trial.planCode)} trial, then continues on the free plan. ${placeholder ? "The prices shown are provisional." : "Purchases open at the end of the beta at the prices shown."}`
      : "Paid plans are not on sale during the beta. Start on the free plan; purchases open at the end of the beta."
    : placeholder
      ? "Prices and limits shown are provisional while we finalise pricing. Nothing is charged without a plan you choose, and the free plan stays free."
      : null;

  return (
    <div>
      {notice && (
        <p className="mx-auto mb-6 max-w-[46rem] rounded-lg border border-dashed border-border bg-surface px-4 py-2.5 text-center text-[13px] text-muted">
          {notice}
        </p>
      )}

      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((plan) => {
          const e = plan.entitlements;
          const highlight = plan.code === "growth";

          return (
            <div
              key={plan.id}
              className={
                "relative flex flex-col rounded-xl border bg-surface p-7 " +
                (highlight
                  ? "border-brand shadow-[0_0_0_1px_#4f75fe,0_12px_32px_-20px_rgba(79,117,254,0.5)]"
                  : "border-border")
              }
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[17px] font-medium">{plan.name}</h3>
                {highlight && (
                  <span className="rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-brand-ink">
                    Recommended
                  </span>
                )}
              </div>
              <p className="mt-1.5 min-h-10 text-[14px] leading-relaxed text-muted">{plan.description}</p>

              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="display text-[40px] text-ink">
                  {plan.isFree ? "$0" : money(plan.monthlyPrice)}
                </span>
                <span className="text-[14px] text-muted">/month</span>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {plan.isFree ? "Free forever, no card needed" : `or ${money(plan.yearlyPrice)} billed yearly`}
              </p>

              <ul className="mt-7 space-y-2.5 border-t border-border pt-6 text-[14px] text-text-secondary">
                <li className="flex items-center gap-2.5">
                  <Ico name="check" className="h-3.5 w-3.5 shrink-0 text-success" />
                  {compact(e.events_per_period)} events per month
                </li>
                <li className="flex items-center gap-2.5">
                  <Ico name="check" className="h-3.5 w-3.5 shrink-0 text-success" />
                  {plural(e.sites, "website", "websites")}
                </li>
                <li className="flex items-center gap-2.5">
                  <Ico name="check" className="h-3.5 w-3.5 shrink-0 text-success" />
                  {retention(e.retention_days)} of history
                </li>
                <li className="flex items-center gap-2.5">
                  <Ico name="check" className="h-3.5 w-3.5 shrink-0 text-success" />
                  {plan.overagePricePer1k === null
                    ? "Pauses at the limit, never a surprise bill"
                    : `${money(plan.overagePricePer1k)} per extra 1,000 events, with a spending cap you set`}
                </li>
              </ul>

              <ul className="mt-4 flex-1 space-y-2 text-[13.5px]">
                {FEATURE_ROWS.map(({ key, label }) => {
                  const on = Boolean(e[key]);
                  return (
                    <li
                      key={key}
                      className={"flex items-center gap-2.5 " + (on ? "text-text-secondary" : "text-muted/70")}
                    >
                      {on ? (
                        <Ico name="check" className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 text-center leading-none">
                          –
                        </span>
                      )}
                      <span className={on ? "" : "line-through decoration-muted/40"}>{label}</span>
                    </li>
                  );
                })}
              </ul>

              <ButtonLink href={SIGNUP_URL} tone={highlight ? "primary" : "outline"} className="mt-8 w-full">
                {plan.isFree
                  ? "Start free"
                  : plan.purchasable
                    ? `Choose ${plan.name}`
                    : billing.trial
                      ? "Start with the free trial"
                      : "Start free"}
              </ButtonLink>
            </div>
          );
        })}
      </div>
    </div>
  );
}
