---
title: How to track website traffic without tracking your users
seoTitle: How to Track Website Traffic Without Tracking Users
description: Analytics and user tracking are not the same thing. What you can measure without identifying anyone, what it costs you, and ten questions to ask any vendor.
date: 2026-09-18
author: The Webyz team
tags: [privacy, analytics, how-it-works]
---

# How to track website traffic without tracking your users

Website analytics and user tracking get treated as the same thing. They are not.

You can know how many people visited, which pages they read, where they came from and whether they did the thing you built the page for, without ever building a profile of a single person.

That distinction matters more than it used to. Website owners want useful numbers and also want to leave their visitors alone. Most of them do not want to collect personal information, deploy invasive techniques, or negotiate a consent flow just to find out whether last week's article worked.

This guide covers what traditional analytics collects, how cookieless approaches differ and where they quietly fail, which metrics survive without identifying anyone, what you give up, and the questions worth asking a vendor. We answer all of them for ourselves at the end, because a post like this that dodges its own questionnaire is not worth much.

## Analytics is not personal tracking

Two different activities wear the same name.

**Website analytics** is about the performance of a site. How many visitors, which pages, which sources, which devices, which campaigns, how many signups. The unit of interest is the page, the source, the campaign. The goal is to improve the site.

**Personal tracking** is about following individuals: persistent identifiers, cross-session and cross-site linkage, behavioural profiles, advertising identifiers, browsing activity joined to personal information. The unit of interest is the person.

Some businesses need user-level analytics for legitimate reasons, and if you are one of them you should use a tool built for it and be straight with people about it. Most websites are not one of them and adopt the machinery anyway, because it came bundled with the answer to "how many visits did we get".

Privacy-first analytics starts from a different question:

> What is the least we can collect and still understand how this website is doing?

Answer that honestly and the design of the product changes.

## What traditional analytics collects

It depends on the platform, the configuration, the consent state and the integrations, but a conventional setup may collect:

page URLs, referrer URLs, device and browser information, operating system, approximate location, the IP address or a processed form of it, cookies, session identifiers, event interactions, campaign parameters, user properties, and purchase or conversion data. Some platforms then join that across sessions or pass it to advertising and marketing systems.

None of this is automatically sinister. The problem is that most site owners switch it on without knowing what is collected, how long it is kept, who can reach it, or whether they needed it. More data is not better data. If what you need to know is that a page got 500 visits, you do not need to know who the 500 people were.

## Cookies, cookieless, and the trap in between

Cookies are small values stored in the visitor's browser, and they are not all the same thing. A cookie that keeps someone logged in is doing a job the visitor wants. A cookie that recognises them across sessions for advertising is doing a job for somebody else.

**Cookieless analytics** measures a site without storing a persistent identifier in the browser. Depending on the implementation it may work from request timing, the page URL, the referrer, the user agent, approximate location, a short-lived or anonymised value, or purely aggregate counts.

Here is the part most articles skip.

**Cookieless does not mean private.** A tool can set no cookie and still identify people more durably than a cookie ever did, by fingerprinting: combining user agent, screen size, fonts, language, timezone and rendering quirks into a value stable enough to recognise the same browser for months. That is a persistent identifier. It is worse than a cookie in one specific way, which is that the visitor cannot clear it.

So "cookieless" is a statement about storage, not about identification. The question that actually matters is:

**Does the tool build an identifier that persists, and can the visitor escape it?**

Ask that, and the category splits into three:

- **Aggregate only.** No visitor identity at all. Accurate pageviews, estimated visitors.
- **Rotating identity.** An identifier derived per day or per session, with a secret that is thrown away, so nothing links across the boundary.
- **Fingerprinting.** A durable identifier reconstructed from browser characteristics. Cookieless on paper, tracking in practice.

The first two are what people mean by privacy-friendly. The third is the thing to check for.

## What "anonymous analytics" actually means

Anonymous analytics means the system is designed not to identify individuals. Instead of a record that reads:

> User A read three pages, came back tomorrow, clicked this, and arrived from that site.

it produces:

> The site had 2,000 visits this week and the pricing page led.

For most owners the second is the whole job.

It is worth being precise rather than absolute, though. A server still processes requests, and technical information exists in memory and sometimes briefly in logs. Anonymity is a property of what is designed, kept and linkable, not a claim that no byte ever touched a machine. The questions that decide it:

- Is a persistent identifier created?
- Is data used to build individual profiles?
- Is anything shared with advertising networks?
- Is the IP address stored, anonymised, hashed or discarded?
- How long is data kept?
- Can any of it be connected back to a person?

A provider that will not answer those in public is answering them.

## What you can measure without identifying anyone

Most of the dashboard survives intact.

**Pageviews** are the easy case: a record that a page was requested. Nothing about identity is required.

**Top pages** are pageviews grouped by URL, which is the most actionable card most sites have.

**Traffic sources** come from the referrer and the campaign parameters, reported in aggregate: search, social, referral, email, paid, direct.

**Campaigns** work the same way. `utm_source=twitter&utm_medium=social&utm_campaign=product_launch` aggregates perfectly well without knowing who clicked.

**Countries and regions** come from a lookup on the address, which can happen in memory and be discarded. Country level answers almost every question a small site has; street-level precision answers none of them.

**Devices and browsers** need a category, not a person. You do not need a profile to learn that three quarters of your readers are on phones.

**Conversions** are events. A signup happened, a form was submitted, a purchase completed. The event is the thing you needed; the identity of the person is a separate decision you can decline to make.

**Visitors and sessions** are where implementations genuinely differ, and where you should read the documentation:

- Some tools **estimate** unique visitors, because with no identifier there is nothing to count. Simple Analytics is open about doing this.
- Some derive a **rotating identifier** and count it exactly, which gives a true count within the rotation window and no linkage beyond it.

Both are defensible. They are not the same number, and neither will match GA4. Compare a tool against itself over time and never against another tool's absolute figures.

## What you give up

Any article recommending this that does not list the costs is selling something. There are three, and they are real.

**No returning visitors.** If the identifier does not survive the night, "new versus returning" cannot exist. Neither can a cohort followed over a month.

**No multi-day funnels.** Conversions are measured inside a visit. A funnel spanning a fortnight of research is not a question this data model can answer, for anyone, whatever the marketing page says.

**Shared addresses blur.** An office, a school or a household on one address and one browser version can collapse into a single visitor. A cookie would have told them apart.

If your work depends on following one person across weeks, you want a different category of tool and a consent flow to match. If you want to know what is read, what brings people in and what converts inside a visit, these three cost you nothing.

## Data minimisation, and why it is a self-interested choice

Data minimisation means collecting only what a specific purpose requires.

Say you run a blog. You want to know which articles are popular, where readers come from, whether traffic is growing and which devices they use. Do you need persistent visitor IDs, cross-site tracking, individual browsing histories, advertising profiles, precise location and long-term behavioural records to get there?

No. And the surplus is not free. Every field you collect is more to secure, more to retain, more to disclose, more to explain to a regulator, more to cover in a consent flow, and more to lose. A smaller footprint is easier to run, easier to explain and much cheaper to get wrong.

Privacy is not a feature bolted on at the end. It is a decision about what the product collects, made before anything is built.

## How to implement it well

Choosing a privacy-focused tool is one step. Using it carelessly undoes it.

### 1. Decide what you need to measure

Start with the site's goal. A blog needs pageviews, referrers and top pages. A SaaS site needs pricing page traffic, signups and conversions. A shop needs product views, carts and purchases. A portfolio may need three numbers. Do not track something because the platform offers it.

### 2. Keep personal data out of the pipe

Never send names, email addresses, phone numbers or tokens to an analytics system without a deliberate, justified design for handling them.

URLs are the usual leak, because they are collected automatically and nobody reviews them:

```text
/reset-password?token=secret-value
/profile?email=someone@example.com
/search?q=my+medical+condition
```

All three send something into analytics that should never have left the server. Audit your query parameters, your search paths and any user-generated URL segment before you install anything.

### 3. Read the settings, do not trust the defaults

Check cookie use, IP handling, retention, identification, cross-site behaviour, event properties, data sharing, integrations and export permissions. A default configuration is tuned for the vendor's median customer, who is not you.

### 4. Be careful with custom events

Event properties are where personal data gets in by accident. `button_clicked` is a fine event. `user_email_submitted: someone@example.com` is a data breach with a friendly name. Use generic names and send the smallest value that answers the question.

### 5. Say so in your privacy policy

Document the tool, what it collects, why, and how long it is kept. Privacy-friendly analytics still belongs in the policy. Being able to point at a clear paragraph is worth more than the best marketing claim.

### 6. Check your obligations

Reducing collection reduces exposure. It does not by itself make you compliant with anything. What applies depends on where you operate, where your visitors are, what you collect, whether cookies are involved, whether consent is required, which processors you use and how sensitive the site is.

We are not lawyers, and nothing here is legal advice. If your visitors are covered by the GDPR or a similar regime, take the technical facts to someone qualified and let them make the call.

## Ten questions to ask any analytics vendor

Marketing pages say "privacy-first", "cookieless" and "GDPR-friendly". Those phrases are not evidence. These questions are:

1. **Does it use cookies?** If so, for what, and are they essential, persistent or session-based?
2. **Does it create a persistent visitor identifier?** Including by fingerprinting, which needs no cookie.
3. **Does it store IP addresses?** Stored, hashed, truncated or discarded, and at which step?
4. **Does it build user profiles?** Across sessions, across sites, or not at all?
5. **Does it share data with third parties?** Look for advertising networks and data brokers specifically.
6. **Where is the data stored?** Region, processors, and whether residency is an option.
7. **How long is it retained?** And does retention mean deleted, or merely hidden?
8. **Can you export and delete your data?** Ownership matters most on the day you leave.
9. **Is the script lightweight?** Analytics should not be a tax on the page.
10. **Is the methodology documented?** Visitors, sessions, bounce rate and duration should each have a published definition.

## Our own answers

Putting those questions to everyone else and not to ourselves would be cheap. Here are Webyz's answers, all of them checkable in the source, which is public.

| Question | Webyz |
| --- | --- |
| Cookies? | None. The only thing written to the browser is a `webyz-disabled` flag, and only if a visitor calls `webyz.optOut()`. |
| Persistent identifier? | No. `sha256(daily_salt + site_id + ip + user_agent)`, where the salt is random, new every UTC day, and kept for 48 hours. Tomorrow's value cannot be matched to today's, by us or by anyone holding the database. |
| Fingerprinting? | No. The inputs above are all the request already carries, and the rotating salt is what stops them being durable. |
| IP addresses? | Used for the hash and the country lookup, then dropped. No visitor IP is written to any table or log. Signing in to the dashboard records the IP of that login, the way any account system does. |
| User profiles? | None. A visit is the largest unit; nothing links across a day. |
| Third parties? | None. No advertising network, no data broker, no analytics on your analytics. |
| Where is it stored? | Our servers for the hosted product, or yours: Webyz is AGPL-3.0 and self-hosting is one script and one compose command, in which case none of it reaches us at all. |
| Retention? | Set by plan, and it is currently an access rule rather than a delete: reads are cut at the retention boundary, and the underlying rows are not yet purged. Self-hosting gives you the database and therefore the last word. |
| Export and delete? | CSV export per dataset, a JSON export of everything your account holds, and account deletion that cancels billing and purges your analytics. |
| Script weight? | About 6 KB gzipped, loaded with `defer`. Do Not Track is honoured by default. |
| Methodology? | A visit ends after 30 minutes of inactivity and cannot cross UTC midnight, because the identifier is rebuilt daily. A bounce is one pageview with no custom event. Visit duration is measured from how long the page was actually visible, so a single-page read is not recorded as zero seconds. |

Two of those answers are worse than we would like. Retention hides rather than deletes, and the UTC midnight boundary means a visit that spans it is counted twice. Both are written down here rather than left for you to discover.

## Analytics does not have to become surveillance

The assumption underneath most tracking stacks is that useful analytics requires detailed tracking. It does not.

Traffic is up. This article is doing the work. Most people arrive from search. The majority are on phones. The campaign is bringing visitors. The signup page is converting badly.

Every one of those is a decision you can act on this afternoon, and not one of them required knowing who anybody was. The goal is to understand the website, not the people visiting it.

## Where Webyz fits

Webyz exists because we wanted the useful half without the other half.

The overview is one page: unique visitors, total visits, total pageviews, views per visit, bounce rate and visit duration, each against the previous period. Under them are traffic sources and channels, UTM campaigns, top pages, entry and exit pages, countries, regions and cities, browsers and versions, operating systems, device types, screen sizes and languages. Click a row and the dashboard filters to it. Goals, funnels, journeys, realtime and saved segments are there when the question gets sharper.

What it will not do is tell you who anyone is, and that is the design rather than a gap in the roadmap.

If you are weighing this against other tools, [our comparison of seven alternatives](/blog/google-analytics-alternatives) has prices read from each vendor's own page and an honest limitations section for every one of them, ours included. If the dashboard side interests you more than the privacy side, [why Google Analytics feels so complicated](/blog/simple-website-analytics) covers which metrics earn their place.

## Final thoughts

Privacy-friendly analytics is not about giving up useful data. It is about being deliberate about which data is useful.

You almost certainly do not need to know who each visitor is to know whether the site is working. You need reliable information about traffic, content, sources, devices and conversions, and you need to know how each of those numbers is defined.

Before you choose a platform, look past the dashboard: the identifiers, the IP handling, the retention, the hosting, the sharing, the documentation. Ask the ten questions. Make the vendor answer them in writing.

Then pick the tool that answers them the way you would want your own data handled.

[See what Webyz shows you](/pricing), or read the [privacy policy](/privacy) and the [tracker guide](/docs/tracker) first, which is the order we would do it in.
