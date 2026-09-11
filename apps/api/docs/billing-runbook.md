# Webyz billing runbook

Production prerequisites and operating procedures for the Paddle Billing
integration. Code enforces what it can; the items marked **Dashboard** are
Paddle account settings that no code can set and that must be verified before
live billing.

Paddle is the **merchant of record**: it sells to the customer, takes the
payment, charges the tax and pays out. Consequences that shape everything
below:

- no card, mandate or tax detail ever reaches this server;
- there is no usage metering. Overage is computed from our own ledger and
  billed as a one-off charge on the subscription, so the arithmetic, the
  rounding and the idempotency are ours;
- there is no provider-side schedule for a plan change. A deferred downgrade
  is "bill the new price from the next renewal" plus a local pending record
  that holds entitlements until the paid period ends.

## 1. Paddle account configuration (Dashboard, before go-live)

### 1.1 Payment recovery: never cancel on a failed usage charge

Paddle > Retain > Payment Recovery (live accounts only; not testable in
sandbox).

- Default behaviour is up to 7 retries over 30 days and then **cancel**.
- Set the end action to **leave past due** or **pause**, never cancel.

Why: an annual customer prepays a year and is charged monthly for overage. A
failed overage charge must not cancel the subscription, or the prepaid year is
revoked. The application maps `past_due` to a 14 day grace window (ingest on,
dashboards on, entitlements kept), then restricts ingest, and only
`subscription.canceled` moves a customer to Free. That protection is defeated
if Paddle cancels.

There is no API for this setting. Screenshot it after changing it, because
nothing in the codebase can assert it.

### 1.2 Prices

`npx tsx scripts/paddle/setup.ts` does this from the plan catalog: it creates
one product and two prices per paid plan, tagged
`custom_data.webyz_plan` / `webyz_cycle`, and writes the ids onto the `plans`
rows. Re-running is safe, so the ids stay stable. `--dry-run` shows what it
would do; a live key needs `ALLOW_LIVE=1` and refuses while
`BILLING_CONFIG.pricingFinal` is false. `npx tsx scripts/paddle/probe.ts`
reports what the account holds and whether the `plans` rows point at prices
that exist in it.

What the script creates, and what to check by hand in Paddle > Catalog:

- one product per plan;
- a monthly price and a yearly price on that product, `tax_mode` matching the
  account default, amounts equal to the catalog's
  `monthlyPrice` / `annualPriceFor(monthlyPrice)` in the plan currency;
- nothing for overage. It is billed as a non-catalog item priced from
  `overagePricePer1k`, created against the plan's own product so the line sits
  under the right product in Paddle's reports.

A plan whose `plans` row has no price ids is reported `purchasable: false` by
`GET /plans`, and both front ends say so rather than opening a checkout that
would fail.

Check the **tax category** the script sets (`saas`) against how Paddle
classifies the product in your jurisdiction: it decides the rate Paddle
charges the customer.

Do the live account only once `BILLING_CONFIG.pricingFinal` is true and the
prices are approved. Sandbox and live are separate accounts with separate ids,
so nothing carries over: the script is run once per environment.

### 1.2a Currencies: automatic conversion OFF

Paddle > Business Account > Currencies: **uncheck every currency**, so every
subscription is billed in the catalogue's currency (USD) and the customer's
card does any conversion.

Why, verified in the sandbox on 9 Sep 2026: with conversion on, Paddle sold
the $19.00 Growth price to a EUR customer for €16.33 and would have sold it
to an Indian customer for ₹3,948 plus tax. The overage charge is a one-off
item priced from `overagePricePer1k` in USD cents, and **Paddle ignores the
currency on a one-off item and bills the raw number in the subscription's
currency**: 80 USD cents sent to that EUR subscription previewed as 80 EUR
cents, and to an INR subscription would be 80 paise, a 98% under-charge. The
70c minimum check is in USD too. The provider refuses to charge when the
currencies differ (`assertChargeCurrency`), so turning conversion on does
not bill wrong numbers, it stops billing overage at all.

Per-currency overage rates are possible (`unit_price_overrides` per country
on a non-catalog item, priced by us) if localised prices are ever wanted;
that is a pricing decision and a code change, not a toggle.

### 1.3 Checkout

**Set the default payment link. It is not optional.** Paddle > Checkout >
Checkout settings > Default payment link, pointed at the dashboard's billing
page (`<app>/settings/billing`).

Without it Paddle refuses to create a transaction at all:
`transaction_default_checkout_url_not_set`, verified in the sandbox. That
blocks any API-created transaction, which means invoice-collected transactions
and, by the same rule, very likely the one-off overage charge. The setting is
dashboard only.

The link matters for a second reason: Paddle sends customers to it to finish
a payment (a failed renewal, an invoice), with `_ptxn=<transaction>` appended.
The billing page reads that parameter on load, fetches
`GET /billing/checkout-config` and initialises Paddle.js, which opens that
transaction's checkout by itself. So the default payment link must be the
production dashboard's `/settings/billing`, and nothing else.

Checkout itself is the **overlay**, opened from the dashboard with
`Paddle.Checkout.open` using the public client token the API serves at
`POST /billing/checkout`, so no hosted page of Paddle's is used in the normal
flow. The link above is a prerequisite of the API, not of that flow.

Confirm the domain hosting the dashboard is on Paddle's approved domain list,
or the overlay refuses to open in production.

### 1.4 Notification destination (webhooks)

Paddle > Developer tools > Notifications > New destination:
`https://<api-host>/api/v1/paddle/webhook`, type "webhook". Subscribe to
exactly this list:

```
subscription.created
subscription.activated
subscription.trialing
subscription.updated
subscription.past_due
subscription.paused
subscription.resumed
subscription.canceled
transaction.billed
transaction.paid
transaction.completed
transaction.payment_failed
transaction.past_due
transaction.canceled
transaction.revised
```

`npx tsx scripts/paddle/setup.ts --webhook https://<api-host>/api/v1/paddle/webhook`
creates or updates the destination with exactly the events the code handles,
so the list cannot drift from `PADDLE_HANDLED_EVENT_TYPES`. Copy the
destination's secret key from the dashboard into `PADDLE_WEBHOOK_SECRET`; no
script prints it.

Every handler **re-reads the object from the API** rather than trusting the
event body, because Paddle guarantees no ordering. The endpoint is idempotent:
`event_id` is the primary key of `billing_events`, so a redelivery is answered
without side effects. `notification_id` identifies the delivery, not the
event, and must never be used as the key.

Deliveries are also checked against Paddle's published sender addresses
(`GET https://api.paddle.com/ips`, sandbox has its own), fetched at first use
and refreshed hourly, never hard-coded, because the list changes. A delivery
from another address is refused with 403 before any work. This is defence in
depth in front of the signature, not a replacement: if the list cannot be
fetched the signature check runs alone. `PADDLE_IP_ALLOWLIST` is on in
production and off in development, where a tunnel delivers from its own
address. Behind a proxy it depends on `TRUST_PROXY`, or every delivery looks
like the proxy and is refused.

Paddle expects a 2xx within 5 seconds and retries up to 60 times over 3 days
(sandbox: 3 times over 15 minutes). Failed notifications can be replayed from
the dashboard for 90 days.

### 1.5 India-registered seller

The account is registered in India. What that means, and what is still
unverified:

- Paddle supports India as a seller country, and being merchant of record is
  precisely why it was chosen: no GST registration, e-mandate handling or
  card storage falls on us.
- Verification has four phases: account, domain review, business
  identification, identity. Live billing is impossible until they complete.
- Payouts are monthly, converted on the 1st and sent by the 15th, minimum USD
  100, by SWIFT wire or Payoneer. Not in INR, and a wire fee may apply.
- **Unverified:** no India-specific KYC list is published. Treat the
  onboarding requirements as unknown until Paddle asks.

### 1.6 Retain

Paddle Retain (payment recovery emails, in-app dunning and cancellation
flows) identifies the signed-in customer through Paddle.js. The billing page
initialises the script with `pwCustomer: { id: <Paddle customer id> }` for any
account the provider knows (`GET /billing/checkout-config` returns the id),
and never for a free account, so a free user's browser fetches nothing from
Paddle. Retain's own settings live in Paddle > Retain.

## 1a. Going live: what Paddle's checklist means here

On the hosted stack every Paddle script runs inside the API container, which
is the only place that has both the production database and the keys:
`./infra/hosted/paddle.sh <script.ts> [args]` from `~/apps/webyz` on the
server (`probe.ts`, `setup.ts`, `sync-webhook-secret.ts`, `deliveries.ts`,
`inspect.ts`). The order for live, each step checked before the next:

1. Decide the prices and set `BILLING_CONFIG.pricingFinal = true`; the seed
   and both pricing pages stop calling them provisional, and `setup.ts` stops
   refusing a live key. Deploy.
2. In the live Paddle account: verification complete; currencies conversion
   off; tax mode "excludes tax"; Retain payment recovery never cancels; the
   default payment link `https://app.webyz.io/settings/billing`; website
   approval for `app.webyz.io`; payment methods (cards, PayPal, Apple Pay,
   Google Pay).
3. Create the live API key and client token, put them in
   `infra/hosted/environment` (`PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`,
   `PADDLE_ENVIRONMENT=production`), `./infra/hosted/deploy.sh --no-build`.
4. `./infra/hosted/paddle.sh setup.ts --dry-run`, then
   `ALLOW_LIVE=1 ./infra/hosted/paddle.sh setup.ts --webhook https://api.webyz.io/api/v1/paddle/webhook`
   (`ALLOW_LIVE` must be present in the environment file, or passed with
   `-e`; the wrapper forwards the file). Then
   `./infra/hosted/paddle.sh sync-webhook-secret.ts` and
   `./infra/hosted/deploy.sh --no-build` so the API loads the secret.
5. `./infra/hosted/paddle.sh probe.ts`: prices on the `plans` rows exist in
   the live account, destination active with all handled events, secret
   matches. `GET https://api.webyz.io/api/v1/plans` reports `purchasable`.
6. One real checkout with a real card on the cheapest plan, then
   `inspect.ts --email` for the buyer; refund it through Paddle afterwards.
7. `REGISTRATION=open` when purchases are meant to be public.


Paddle's "move to production" prompt assumes price ids and environment names
in the code. Here they are not, so most of it is one command or nothing:

| Paddle says | Here |
| --- | --- |
| Recreate the catalogue in live, map old to new ids | `ALLOW_LIVE=1 npx tsx scripts/paddle/setup.ts` with the live key in the environment. It builds the same catalogue from `plans.config.ts` and writes the live ids onto the `plans` rows. It refuses while `BILLING_CONFIG.pricingFinal` is false: the prices are placeholders until someone approves them. Sandbox and live databases are different databases, so nothing is "replaced". |
| Find and replace sandbox price ids in the codebase | Nothing. No price id is in the code. |
| Create a live client token, update env | Paddle > Developer tools > Authentication in the live account; `PADDLE_CLIENT_TOKEN=live_...` in the production environment. |
| Create a live notification destination, update the secret | `npx tsx scripts/paddle/setup.ts --webhook https://<api>/api/v1/paddle/webhook` with the live key, then `sync-webhook-secret.ts` or copy the secret into `PADDLE_WEBHOOK_SECRET`. |
| Remove `Paddle.Environment.set('sandbox')`, swap `sandbox-api.paddle.com` | Nothing. The environment is derived from the API key (`pdl_live_...`) and served to the dashboard by the API; no environment string exists in either codebase. |
| Add `pwCustomer` for Retain | Done (section 1.6). |
| Allowlist Paddle's IPs from `/ips` | Done (section 1.4); on by default in production. |
| Live API key, domain approval, default payment link | Dashboard. Default payment link must be the production dashboard's `/settings/billing` (section 1.3). Domain approval is manual in live and an unapproved domain makes the overlay fail to load. |
| Currency conversion | **Off** in the live account too (section 1.2a). Tax mode "excludes tax". Retain payment recovery: never cancel (section 1.1). |

### Live account state, 9 Sep 2026

Done: live API key and client token in the hosted environment; destination
`ntfset_01m22r76yxmjjbfg0qhh5y5nyx` at `https://api.webyz.io/api/v1/paddle/webhook`
with all 15 events and its secret synced; IP allowlist enforced (a POST from a
non-Paddle address answers 403); pricing final; catalogue created (3 products,
6 prices) and the ids on the `plans` rows; `GET /plans` reports every paid plan
purchasable. Not done, dashboard only: verification, currencies conversion
off, tax excludes, Retain never cancel, default payment link, domain approval,
payment methods, payout details. `REGISTRATION` was opened the same day: the
domain reviewer read a closed signup on `app.webyz.io` as a login wall, and
purchases are gated by Paddle regardless.

## 2. Environment

```
PADDLE_API_KEY          pdl_live_apikey_... or pdl_sdbx_apikey_...
PADDLE_CLIENT_TOKEN     live_... or test_...; public, served to the dashboard
PADDLE_WEBHOOK_SECRET   pdl_ntfset_...; the destination's secret key
PADDLE_ENVIRONMENT      sandbox | production; defaults from the API key
PADDLE_IP_ALLOWLIST     on | off; default on in production
```

`BILLING_ENABLED` is true only when the API key and the client token are both
set: managing a subscription needs the first, opening checkout needs the
second, and a plan nobody can buy must not be advertised as purchasable. With
either unset every customer is on Free, checkout returns a clear error, and
the charging job is disabled.

## 3. Ingest restriction precedence

`subscriptions.restriction` and `websites.is_blocked` have exactly one writer:
`reconcileRestriction` in `src/core/billing/state/restriction.service.ts`,
which evaluates the pure decision in `state/restriction.ts` over the whole
account (status, grace deadline, spend cap, quota) inside one transaction
holding a row lock on the user. Payment webhooks, grace expiry, spend-cap
enforcement, cap changes, period rollover, trial start and expiry, plan
changes and site creation all change their own fact and then call it; none
decide on their own whether to block or unblock.

Precedence, highest first:

| Restriction | Condition | Lifted by |
| --- | --- | --- |
| `PAYMENT_FAILED` | status `unpaid`, or `past_due` with the 14 day grace lapsed | payment (a completed transaction) only |
| `SPEND_CAP` | pay-as-you-go and the period's cost has reached the cap | raising the cap, or the next usage period, never while unpaid |
| `FREE_QUOTA` | free or trial plan at its allowance | next period, trial start, or a paid plan, never while unpaid or capped |
| `NONE` | none of the above | - |

Consequences to expect when reading the tables: a subscription can be
`PAST_DUE` with restriction `SPEND_CAP` (cap hit during grace); raising the
cap while `PAYMENT_FAILED` records the new cap but changes nothing else and
the API says so; a site created under a restricted account is created
blocked; the restriction and every site's `is_blocked` never disagree.

## 4. Periods

The provider's billing period is the **base** period: a month, or the prepaid
year. The **usage** period is always about a month, because quotas and overage
are monthly, and for an annual customer it is derived locally
(`subscription/periods.ts`), anchored to the day the base period started and
clipped to the end of the prepaid year.

Nothing at the provider moves that window, so `sync-usage` rolls it: free,
trial and annual subscriptions all pass through `rollLocalUsagePeriods`
first, and `ensureOpenPeriod` then closes the window that has ended.

## 5. Jobs

| Job | Cadence | What it does | Safe to re-run |
| --- | --- | --- | --- |
| `sync-usage` | hourly | Backfills free rows, rolls local usage windows (free, trial, annual), recomputes hourly usage buckets from ClickHouse, closes rolled periods | yes, idempotent |
| `enforce-limits` | hourly | Re-evaluates the restriction for lapsed grace, cap and quota through the single writer; sends warning, cap and quota emails once per period | yes |
| `charge-overage` | hourly, 5 min after sync | Charges each closed period's overage once, checkpointed in `reported_events` | yes, retries unfinished records first under the same key |
| `apply-plan-changes` | hourly | Moves a due deferred downgrade onto the local plan and reconciles sites | yes, idempotent |
| `trials` | hourly | Trial reminders and expiry to Free | yes |

Jobs hold a Redis lock for 90% of their interval. To force a run after a
deploy: `redis-cli DEL cron:lock:<name>`.

## 6. Overage charging

An open period is never charged: it is still accruing. When a period closes,
`charge-overage` sends one charge for everything above the allowance:

- units = `ceil(overage events / 1,000)`, priced at the plan's
  `overage_price_per_1k`;
- `effective_from: immediately`, so an annual customer is billed monthly for
  usage as the terms promise and a cancelling customer cannot walk away from
  it;
- the idempotency key is `<periodId>:<cumulative overage>`, stamped into the
  charge item's `custom_data` as `webyz_charge_key` (snake case: the SDK
  snake-cases custom data on the way out and Paddle returns it as stored).
  Paddle has no idempotency header for a subscription charge, so the provider
  looks for that key on the subscription's recent charge transactions before
  charging and after, which is what makes a retry after a crash safe. Verified
  in the sandbox: a second call with the same key returned the same
  transaction and created nothing;
- **Paddle refuses any transaction under 70c USD**
  (`subscription_update_transaction_balance_less_than_charge_limit`, verified).
  A closed period whose overage is worth less is **waived**: the checkpoint
  moves, a `usage_records` row with status `WAIVED` says why, and no
  transaction exists. On Growth that is anything under 35,000 events over the
  allowance. The alternative, carrying pennies across periods, was not worth
  the ledger complexity for at most 69c a month per customer; if that view
  changes, `BILLING_CONFIG.usage.minChargeCents` is the one knob and the waiver
  is the one branch;
- the charge item's `name` is fixed ("Extra events") because Paddle caps it at
  50 characters; the dated text the customer reads is the `description`;
- the checkpoint `reported_events` moves only once the provider has accepted
  the charge, in the same transaction as the record.

A downward correction (events deleted after charging) is never sent as a
negative. The checkpoint stays and reconciliation shows the gap.

## 7. Monitoring

Query these regularly, alert on non-zero:

```sql
-- webhook handlers that threw (Paddle will redeliver; investigate the error)
SELECT id, type, error, received_at FROM billing_events WHERE status = 'FAILED';

-- overage charges stuck after several attempts
SELECT id, billing_period_usage_id, attempts, last_error
FROM usage_records WHERE status IN ('PENDING','FAILED') AND attempts >= 3;

-- closed periods whose ledger overage exceeds what was charged (lag or failure)
SELECT id, subscription_id, overage_events, reported_events
FROM billing_period_usages WHERE overage_events > reported_events AND status = 'CLOSED';

-- periods where charged exceeds ledger (late downward correction; review before crediting)
SELECT id, subscription_id, overage_events, reported_events
FROM billing_period_usages WHERE reported_events > overage_events;

-- accounts with more than one live provider subscription (billed twice; cancel one at the provider and refund)
SELECT user_id, count(*) FROM subscriptions
WHERE provider_subscription_id IS NOT NULL AND status IN ('ACTIVE','TRIALING','PAST_DUE','UNPAID')
GROUP BY user_id HAVING count(*) > 1;

-- deferred downgrades that should have applied by now
SELECT id, user_id, pending_plan_id, pending_change_at
FROM subscriptions WHERE pending_change_at < now() - interval '2 hours';
```

Log lines to alert on: `[invoice] ANOMALY` (a base charge inside a prepaid
term), `[charge-overage] ... too old to charge` (a period aged past 60 days;
bill manually), `[subscription] ANOMALY` (a due plan change the provider never
took), `[subscription] ... cannot resolve owner` or `cannot resolve plan`.

## 8. Reconciliation (per closed usage period)

Run `npx tsx scripts/billing/reconcile.ts [--days 35] [--no-provider]` from
`apps/api`. It prints one row per closed pay-as-you-go period with the ledger
overage, the charging checkpoint, the charge transaction and its invoice line,
and exits 1 when anything disagrees. Schedule it daily. It never writes.

What it checks, and what to do:

1. Ledger: `billing_period_usages.overage_events` and `reported_events` should
   be equal once the period is closed and the charge job has run.
2. Charge records: the `usage_records` rows for the period should sum to the
   checkpoint, and each should name the transaction it created.
3. Transaction: its status should be `billed`, `paid` or `completed`. Anything
   else is money not collected.
4. Invoice: the `billing_invoices` row for that transaction. `usage_units`
   should equal `ceil(reported_events / 1000)` and the line amount
   `usage_units * overage_price_per_1k`. `has_base_line` must be false on an
   annual customer's usage charge.
5. Differences are recorded, never resolved by overwriting the ledger. Credit
   or re-bill through Paddle and note the transaction id.

## 9. Paddle behaviours the code depends on

Items marked **verified** were observed against the sandbox on 9 Sep 2026;
the rest are documented and still worth re-checking. The sandbox cannot
exercise payment recovery at all (section 1.1).

- **Verified:** a manually collected transaction created with status `billed`
  creates and activates the subscription immediately, before payment.
  `subscription.created` and `subscription.activated` fire with it.
- **Verified:** the API cannot mark a transaction paid (`status: paid` is
  rejected); payment is recorded only by an actual payment. `transaction.paid`
  and `markPaymentSucceeded` therefore need a real checkout or bank transfer.
- **Verified:** no transaction can be created, by API or overlay, until the
  account has a default payment link (section 1.3).
- **Verified:** the one-off charge (`createOneTimeCharge`) works on a live
  subscription, raises a `subscription_charge` transaction, fires
  `transaction.billed` and `subscription.updated`, and the custom price it
  creates carries our `custom_data` key, which the idempotency scan finds.
- **Verified:** the 70c minimum, and the 50 character cap on a price name.
- **Verified:** the overlay attaches the subscription to the customer whose
  **email was typed into it**, not necessarily the customer id passed in. A
  different address means a second Paddle customer, with the subscription and
  invoices under it. `syncSubscription` follows the money and re-points the
  user at the subscription's customer, so the portal and invoice list stay
  right.
- **Verified:** a customer can complete two checkouts before the first webhook
  lands (here: a dead tunnel; in production, seconds of webhook latency), and
  Paddle happily runs both subscriptions. The local rule "one live row per
  user" retires the older local row but cancels nothing at the provider, so
  the sync logs `ANOMALY ... also has live provider subscription` and the
  monitoring query above finds it. Resolving it (cancel one, refund) is a
  human decision.
- **Verified:** a real card payment through the overlay: `transaction.paid`
  and `transaction.completed` processed, invoice recorded as paid, trial row
  retired, restriction clear.
- **Verified:** a one-off charge item's currency code is ignored; the amount
  is billed as-is in the subscription's currency (section 1.2a).
- **Verified:** manual (invoice) collection is limited to USD, GBP and EUR,
  and a EUR invoice to an EU address needs a business entity; a US address
  with EUR currency is accepted.
- **Verified:** a replayed notification is answered `duplicate` and changes
  nothing; a redelivery with a wrong secret is answered 400 and Paddle logs
  the body of our refusal against the notification, which is where to look
  first when nothing arrives.
- **Verified:** `order_by` on `GET /notifications` accepts only `id`; the ids
  are time-ordered, so `id[DESC]` is newest first.

- All recurring items on one subscription must share an interval, which is why
  a plan is exactly one recurring price and overage is a separate one-off
  charge rather than a second item.
- `PATCH /subscriptions/{id}` replaces the whole item list: an omitted item is
  removed. The provider always sends the complete list.
- `proration_billing_mode: do_not_bill` changes the items now and bills the new
  price from the next renewal. That is the deferred downgrade; entitlements are
  held on the old plan by the local pending record, not by Paddle.
- `on_payment_failure: prevent_change` means an upgrade whose payment fails
  does not apply, so nobody holds entitlements nobody paid for.
- A subscription cannot be updated while `past_due`, or within 30 minutes of a
  renewal. Both surface as a provider error the billing page shows.
- `POST /subscriptions/{id}/cancel` with `effective_from: next_billing_period`
  creates a `scheduled_change`; clearing `scheduled_change` undoes it. A
  subscription already canceled cannot be reinstated.
- A charge answers with the subscription, not the transaction, so the
  transaction is found by the idempotency key stamped on its price.
- The invoice PDF link expires within the hour, so it is fetched per click
  (`GET /billing/invoices/:id/pdf`) and never stored.
- `Paddle-Signature` is `ts=<unix>;h1=<hex>`, an HMAC-SHA256 over
  `<ts>:<raw body>`. Verification runs on the exact bytes received; the route
  keeps the raw buffer for that reason. Signature checking uses the SDK, but
  the payload is parsed with `JSON.parse` rather than the SDK's `unmarshal`,
  which builds a typed entity per event and throws on a field it did not
  expect: a verified payload must never be refused over a shape detail.

## 9a. Live end-to-end test, zero cost

`scripts/billing/grant-trial.ts --email <email>` gives one account a fresh
trial outside the signup rules (operator override, e.g. the operator's own
account after this test left it on Free).

`scripts/paddle/live-test.ts` runs the live version of the sandbox scenario
without a refund: a 100% one-use discount restricted to the catalogue prices
(`discount create --code CODE`), one real checkout by the operator with a real
card at a $0 total, then `upgrade <sub> --price <pri>` with `do_not_bill`,
`cancel <sub> --period-end`, `cancel <sub> --now`, and `discount archive
<dsc>`. After each step `inspect.ts --email` shows the local rows and
`deliveries.ts` the webhook deliveries. Every write needs `ALLOW_LIVE=1`.
A $0 recurring checkout still collects a card, so it exercises the same path
as a paid one; the discount is one-time, so a forgotten subscription would
renew at full price, which is why the test ends with an immediate cancel.

Run on 10 Sep 2026 against the live account, all steps passed: discount
`dsc_01m24w3mm4y30kn140r5seesax` (archived, used once), transaction
`txn_01m24wayjvrdm3wzsw89vqg9qt` completed at $0 with the discount attached,
subscription `sub_01m24wejtnjeny3x7wybb9ha5q` created, upgraded to Growth,
scheduled to cancel, cancelled. Eight webhook deliveries, all 2xx and
PROCESSED. Reconciliation clean (no closed periods yet). Paddle keeps the
abandoned `draft`/`ready` checkout transactions from earlier attempts; they
expire on their own and bill nothing.

## 10. Sandbox verification

Run on 9 Sep 2026 against the sandbox, with `scripts/paddle/setup.ts` for
the catalogue and destination, `sandbox/invoice-subscription.ts` and
`sandbox/overage-charge.ts` for the scenarios, `deliveries.ts` to replay what
a dead tunnel dropped, and `inspect.ts --email` to read both sides.

Done, and what was seen:

1. Catalogue provisioned: 3 products, 6 prices, ids on the `plans` rows,
   re-run idempotent.
2. `POST /billing/checkout` created a real customer and returned the overlay
   handle; the overlay opened in the dashboard. `GET /billing/portal`
   returned a working portal URL.
3. Webhooks: accepted with the right secret, `duplicate` on replay, 400 on a
   wrong secret or forged signature, with Paddle logging our refusal body.
4. Subscription created from an invoice-collected transaction:
   `transaction.billed`, `subscription.created`, `subscription.activated`
   processed; local row on Growth, trial row retired, periods correct,
   restriction cleared. Events delivered out of order and replayed later
   converged on the same row.
5. Overage: a 6c period was refused by Paddle and is now waived; a 76c
   period raised a real `subscription_charge` transaction, the webhook
   recorded it with a `usage` line, a second call with the same key returned
   the same transaction, and reconciliation tied out with zero findings.
6. Upgrade Growth to Business: `subscription_update` transaction for the
   prorated difference ($29.99 of $30.00 with a day used), items and local
   plan on Business.
7. Deferred downgrade to Starter: provider items on Starter with no
   transaction, local plan pinned to Business with the pending record; undo
   put the provider back with nothing pending and still no transaction.
8. Cancel at period end: `scheduled_change: cancel`, access continuing, local
   `cancelAt` set; resume cleared both.
9. A real card payment through the overlay (`4242 4242 4242 4242`) on a
   Business plan: `transaction.paid`, `transaction.completed`,
   `subscription.created`, `subscription.activated` processed, $49.00 invoice
   recorded as paid, local row ACTIVE on Business, trial retired.

Still to exercise, and why not yet:

- **A failed payment and recovery.** `transaction.payment_failed` needs a
  card that declines (`4000 0000 0000 0002` at checkout); Retain's recovery
  outcomes are live only.
- **The boundary jobs.** `apply-plan-changes` at a real period end and the
  monthly usage roll for an annual subscription. Both are covered by database
  tests; a sandbox pass needs a renewal to happen.
- **Annual checkout and its monthly usage windows** against a real yearly
  price.
