---
title: Open source website analytics: a practical guide
seoTitle: Open Source Website Analytics: A Practical Guide
description: How to choose and run open source website analytics: what the term means, what to measure, how the tools compare, and a self-hosting setup sequence.
date: 2026-11-18
author: The Webyz team
tags: [open-source, privacy, comparison]
---

# Open source website analytics: a practical guide

> **Disclosure: we make Webyz, which is one of the tools compared below.** You should weigh that.

Open source site analytics helps you measure traffic and conversions with code you can inspect and a platform you can run on your own infrastructure. If you need to know which campaign brought signups without installing a sprawling tracking stack, it may suit you. Choose based on the data you need, who will operate the system and the questions the reports must answer.

## What open-source website analytics actually means

An open-source analytics platform publishes code under a license that permits use and inspection, with conditions for modification and redistribution. You may still pay for hosting, and a hosted service controls the server holding your data. Assess the license, deployment options and data flow separately.

With self-hosting, you run the analytics application and its storage. A hosted edition reduces maintenance, though its provider runs part of the pipeline. Cookie-free collection says nothing about the software license or your overall privacy policy. Server log analytics avoids a browser script, but retained raw logs may contain IP addresses.

| Question | Why it matters |
| --- | --- |
| Is the code available under an open-source license? | You can inspect its collection and processing behavior and assess reuse obligations. |
| Can you self-host the application and database? | You decide where the data lives and who has access, at the cost of operating it. |
| What does the collector store? | Anonymization, identifiers and retention matter more than the word "private" on a landing page. |
| Which reports are available? | Pageviews alone cannot tell you whether a visit ended in a signup. |

## When open source is a better fit than a proprietary platform

Choose open source if your team needs to inspect collection code, control where analytics data lives or extend the software. It works well when sources, popular pages and completed goals are enough to guide decisions.

Proprietary software may suit a team that needs managed integrations or specialist features it cannot maintain itself. With open source, you still pay for infrastructure and handle incidents. Privacy also depends on configuration: you can collect far more visitor data than you need, even with an open-source tool.

Write down a reporting question before choosing a product. A content site may need to identify entry pages that bring qualified traffic. A signup flow needs to show where visitors leave between the landing page and account creation. Those questions require different data.

## Measure what you can act on

Your dashboard should connect sources to pages and outcomes. Start with a few questions for each stage instead of collecting every possible interaction.

![Diagram of entry pages leading through a three-step conversion funnel to an analytics dashboard](/images/blog/open-source-analytics-funnel.webp)

| Decision | Useful measurements | What to watch for |
| --- | --- | --- |
| Which channels deserve attention? | Referrers, campaign tags, search traffic, entry pages | Missing referrers and untagged campaigns make channel labels incomplete. |
| Which content helps visitors? | Pageviews, entrances, exits, routes between pages | A high exit rate is not necessarily bad on a page that answers the question. |
| Where does the flow break? | Step-by-step journeys and funnels | A funnel is only useful if the steps reflect the real route to conversion. |
| Did the change work? | Goal completions by source or page, compared over time | Compare equivalent periods and distinguish traffic growth from conversion improvement. |

Count a newsletter subscription on the success page or at successful submission, rather than on a button click that may fail. If visitors arrive from a campaign, read a product page and submit a form, a funnel can show where they leave. Name the completed action `signup_completed` instead of using an ambiguous button label.

Use realtime views to see whether a launch or tracking change is sending data. Judge campaign results over a full reporting period. Search insights may show traffic from search, though pageviews alone cannot reveal every organic query.

## How to choose open source site analytics

Choose based on the analysis you need and the maintenance you can support. Compare collection methods and reports alongside operational work. Server log reports, for instance, cannot replace client-side goal tracking without extra instrumentation.

| Tool | Best fit | Useful capability | Main limitation to plan around |
| --- | --- | --- | --- |
| Webyz | Sites that want privacy-first traffic and conversion views in one dashboard | Page and entry/exit analysis, realtime activity, search insights, journeys, goals and funnels | Self-hosting still means operating the application and storage; confirm the deployment fits your stack. |
| Matomo | Teams that need a broad analytics suite and extensive configuration | Goal and ecommerce reporting, with on-premise deployment | The broader feature set brings more setup decisions; some advanced UX features are paid add-ons. |
| Umami | Teams that want a compact dashboard for traffic and events | Realtime reporting and event tracking | Check that its reporting depth fits a multi-step conversion question. |
| GoAccess | Administrators who already work with server access logs | Realtime log reports without a browser script | Server logs alone do not describe successful client-side actions without additional instrumentation. |

Webyz is open source under AGPL-3.0 and supports self-hosting. Its script is about 7 KB gzipped, simple to install and does not block page loading. Founders and marketers can see sources, viewed pages and completed goals in one dashboard. If you need session recordings or a large plugin ecosystem, assess a more specialized platform rather than assuming a lightweight analytics tool provides them. See the [Webyz analytics overview](/) for the product view.

### A quick selection test

1. Write down the two decisions you want to make next month. If one is "Which page led to signups?", do not settle for pageview-only reporting.
2. Decide whether you need browser events, server logs, or both. Client-side measurement can miss blocked scripts; logs cannot automatically know whether a form succeeded in the browser.
3. Map the data path: browser or server, collection endpoint, database, dashboard, exports and backups. Name who can access each part.
4. Estimate operational work, including upgrades, security patches, database growth, backup restores and alerting. A managed service trades some control for less maintenance.
5. Check the license and deployability before committing. Source availability is not the same thing as permission to run, modify and distribute software without conditions.

## Self-hosting and setup: a practical sequence

Start with a dependable pageview stream and one meaningful conversion. Build journeys after both work.

![Self-hosted analytics flow from browser through HTTPS collector to database, dashboard and backup](/images/blog/open-source-analytics-self-hosted-flow.webp)

1. **Prepare the deployment.** Follow the project's installation instructions for the application and its database, such as the [Webyz self-hosting documentation](/docs/self-hosting). Put the collection endpoint behind HTTPS, restrict dashboard access, and set up backups before collecting production data.
2. **Install the collector.** Add the project's script through your site's template or tag management process, or configure its supported server-side collection path. Load it without blocking page rendering if the project supports that pattern; the [Webyz tracker documentation](/docs/tracker) is the starting point for its implementation.
3. **Define conversions.** Choose success conditions that mean the action actually happened. Keep event names and campaign-tag conventions consistent across pages and teams.
4. **Test the path.** Visit a page with tracking permitted, follow a tagged link, complete the goal and check that the expected source, entry page and goal appear. Test a single-page app route change separately if your site uses client-side navigation.
5. **Test privacy behavior.** Check Do Not Track handling if enabled, inspect browser storage for cookies, and review what requests and identifiers reach your endpoint. Document retention and deletion procedures.
6. **Maintain the service.** Monitor ingestion errors and disk usage, rehearse a database restore, and repeat tracking tests after site releases. A live dashboard can be wrong if events silently stop arriving.

Missing visits often point to blocked requests, an incorrect site identifier, a content security policy restriction or a script absent from some templates. If visits appear but conversions do not, inspect the success condition and event payload before changing the funnel. Record tracking changes so you do not mistake a reporting jump for visitor growth.

## Privacy: what cookie-free tracking does and does not solve

Cookies are one way to recognize visitors. A cookie-free collector may still process IP addresses, user agents or other signals in transit, so inspect what it transmits, retains and uses to calculate counts. Webyz uses daily-rotating visitor hashes, which limit links between visits on different days. You give up long-term person-level analysis in exchange.

Webyz supports Do Not Track and cookie-free tracking. Honoring that browser signal may leave gaps in the numbers, but it respects the visitor's choice. Consent duties also depend on your other scripts and the laws that apply to your visitors. The [ICO's guidance on exceptions for statistical purposes](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/) sets conditions and excludes advertising measurement and individual tracking. As we read it, the exception covers storage or access used solely to collect statistics about a service in order to improve it, provided users get clear information and a simple, free way to object. Read the guidance itself before relying on it. A privacy-first tool does not make your site automatically compliant.

For the collection choices behind this approach, see [tracking traffic without tracking users](/blog/track-traffic-without-tracking-users).

Set retention to match the decisions you make. Restrict dashboard access and keep email addresses or other direct identifiers out of event names and URLs. Control raw access logs separately. If you need individual session histories, account for their privacy cost before choosing a tool designed for aggregate measurement.

## The bottom line

Open source website analytics suits teams that need acquisition and conversion reports along with control over collection. If you care about sources, pages, paths and goals, try Webyz: its lightweight, cookie-free script feeds a single dashboard, and its AGPL-3.0 code and self-hosting option give you more control. If your team needs extensive behavioral recording or lacks capacity to operate a self-hosted service, let those needs drive the choice.
