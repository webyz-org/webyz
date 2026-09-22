---
title: What is website analytics? A simple guide to understanding your website traffic
seoTitle: What Is Website Analytics? A Simple Guide to Website Traffic
description: What website analytics is, how it works, which metrics actually matter, and how to read your website traffic without turning yourself into a data analyst.
date: 2026-09-22
author: The Webyz team
tags: [analytics, metrics, how-it-works]
---

# What is website analytics? A simple guide to understanding your website traffic

If you have a website, you probably want to know one thing before anything else: is anyone actually using it?

A visitor count on its own does not answer that. It tells you how many people arrived, not whether the site did its job.

Where did those visitors come from? Which pages did they open? Were they on a phone or a laptop? Did they find what they came for, or leave in four seconds? Did anyone sign up, buy, or get in touch?

Website analytics is how you answer those questions. It turns visitor activity into information you can act on.

You do not need to be a data analyst to use it. The best analytics setup is usually the one that makes the important things obvious.

## What website analytics actually is

Website analytics is the practice of collecting and interpreting information about how people use a website.

A web analytics tool can tell you:

- How many people visited
- How many visits, or sessions, those people made
- Which pages were opened most
- Where visitors arrived from
- Which countries, regions and cities they came from
- Whether they were on mobile, desktop or tablet
- Which campaigns brought traffic
- Which actions people completed

A worked example makes it concrete. Say you run a SaaS site. You publish a new landing page and share it on X. The next day the dashboard shows:

| Step | Number |
| --- | --- |
| Visitors | 2,400 |
| From X | 1,700 |
| Reached the pricing page | 430 |
| Signed up | 38 |

That reads very differently from "2,400 visitors". You can now see a path: a channel brought people, a proportion of them got as far as pricing, and a smaller proportion converted. Each of those three numbers is a thing you can try to move.

That connection between traffic and outcome is the whole point of website traffic analytics. Everything else is detail.

## Why website analytics matters

Running a website without analytics is like running a shop with the lights off. People may be walking in, picking things up and leaving. You would never know which shelf they stopped at.

Analytics gives you visibility on questions you cannot answer any other way.

**Is my traffic growing?** Compare a period against the one before it, and you know whether the audience is actually expanding or you just had one good day.

**Which content is working?** The top pages report shows which articles, products and landing pages pull attention, and which ones you wrote for nobody.

**Where do visitors come from?** Traffic source data separates search from social, referrals from email, paid from direct. Without it, every promotion is guesswork.

**Which devices do they use?** If most of your audience is on a phone and the site was designed on a 27-inch monitor, that is worth discovering before it costs you conversions.

**Is anyone converting?** Conversion tracking ties traffic to signups, purchases, downloads and form submissions, which is the only way to tell a successful page from a popular one.

The test for any of these is the same: does the number change what you do next? If it does not, it is decoration.

## The website analytics metrics that earn their place

There are hundreds of metrics you could track. You almost certainly do not need them. For most sites, a handful describe the situation well.

### Unique visitors

Roughly how many individual people reached the site. If last month was 1,000 and this month is 1,500, your reach is growing.

Read it with some scepticism, though. A thousand visitors who came looking for exactly what you sell will beat ten thousand who arrived by accident. Reach is a means, not a goal.

### Total visits

A visit, or session, is one continuous stretch of activity. The same person can visit today, leave, and come back tomorrow, and those count as two visits by one visitor.

Visitors tell you about people. Visits tell you about activity, and the gap between the two hints at how often people come back.

One thing worth checking in any tool: how it defines the end of a session. In Webyz a visit closes after 30 minutes of inactivity, which is the common convention, and a visit never spans midnight UTC. Definitions differ between platforms, and a metric you cannot define is a metric you cannot compare.

### Pageviews

How often pages were loaded. This is the core number for blogs, documentation, news and any content-led site.

Views per visit sits alongside it and is often more useful: it tells you whether people read one thing and left, or kept going.

### Top pages, entry pages and exit pages

Total pageviews tell you how much is happening. Top pages tell you where.

Three related reports answer three different questions:

- **Top pages**: what gets read
- **Entry pages**: where people arrive, which is where first impressions happen
- **Exit pages**: where people leave, which is where to look when something is broken

For anyone publishing regularly, these are usually the most-used reports in the dashboard.

### Traffic sources and channels

Where visitors came from. Channels group the sources into the categories you plan around: search, social, referral, email, paid and direct.

Below the channel sits the specific source, and below that the campaign tagging. UTM parameters on your own links let you separate one newsletter from another, or one ad from the ad next to it, instead of watching them all pile into a single bucket.

This is the data that decides where your next hour of promotion goes. Spend six weeks posting in four places, then look at which one actually sent people.

### Countries, regions and cities

Where your audience is. Useful for an international product, and regularly surprising: sites pick up traffic from places nobody targeted.

That can feed real decisions about pricing, currency, language, support hours and where to advertise next.

### Devices, browsers and screen sizes

Phones or computers. Which browsers, which versions, which screen sizes, which languages.

This is the least glamorous data in analytics and the most likely to expose a concrete bug. An old browser with a bounce rate twice the site average is usually a layout that breaks in it.

### Bounce rate and visit duration

Bounce rate is the share of visits that ended without meaningful further activity. Visit duration is how long a visit lasted.

Both need care. A high bounce rate on a page whose job is to answer one question quickly is not a failure, it is the page working. Treat them as prompts to look closer, never as scores.

### Engagement time and scroll depth

Pageviews say a page was opened. They do not say it was read.

Engagement time measures how long a page was actually visible and active, and scroll depth measures how far down people got. On a long article the difference between "opened" and "read to the end" is the difference between traffic and an audience. Webyz records both.

### Conversions

Traffic is rarely the actual goal. A conversion is the thing you built the page to produce: a signup, a purchase, a subscription, a contact form, a demo request, a download.

Goal tracking answers the only question that really matters: is the site doing its job?

A site with 50,000 visitors and nothing converting has a bigger problem than one with 5,000 visitors and a healthy conversion rate. Knowing which situation you are in requires measuring it.

## How website analytics works

The mechanism is simpler than the field makes it sound.

Almost every analytics tool gives you a small script to add to your pages. When someone opens a page, the script sends a short message to the analytics server. The server records it, and the dashboard reads the aggregate back out.

```
Visitor opens a page
        |
Tracking script runs
        |
A pageview or event is sent to the analytics server
        |
The server validates it, filters bots, and stores it
        |
The dashboard queries the stored data and shows the result
```

The differences between tools are in the details of that middle step, and those details are where privacy lives.

Some platforms set a cookie, or another persistent identifier, so the same browser can be recognised weeks later. Some derive a temporary identifier on the server and throw away the raw inputs. Some store the visitor's IP address, some never write it down at all.

Webyz takes the second approach for each of those choices. The script is about 6 KB gzipped, sets no cookies and stores nothing in the browser. The visitor identifier is calculated on the server by hashing the address and user agent together with a salt that is regenerated every day and never stored long term, so the same person is one visitor within a day and cannot be linked across days. The IP address is used for the country lookup and is never written to the database.

That is the useful question to ask any vendor: not only what a tool measures, but what it keeps. We wrote a longer piece on exactly that: [how to track website traffic without tracking users](/blog/track-traffic-without-tracking-users).

## Website analytics and privacy

Website visitor tracking does not have to mean tracking individuals.

There is a real difference between understanding traffic and building a profile of a person. For the overwhelming majority of sites, the first is what you need and the second is a liability you took on by accident.

You rarely need to know who a visitor was. You need to know things like:

- 3,200 people opened this page
- Most of them arrived from Google
- 64% were on a phone
- This landing page produced 47 signups

Every one of those is an aggregate. None of them requires an identity, a cookie banner, or a data processing agreement you have to explain to a customer.

That is why privacy-friendly analytics has grown. It is not only about regulation, though GDPR and its equivalents are a good reason to care. It is that collecting less personal data leaves you with less to secure, less to disclose and less to be wrong about.

A good setup collects what it needs to answer your questions, and no more.

## What about Google Analytics?

Google Analytics is the most widely used web analytics platform there is, and its depth is genuine. For teams running serious paid acquisition, multi-touch attribution and cross-property reporting, that depth earns its cost.

But most websites are not that. A blogger wants to know how many people visited, which articles are popular, and where readers came from. A small SaaS wants visitors, sources, pricing page views and signups.

For those, a large platform can be slower to use than a small one, because the basics sit underneath the advanced. If that is the experience you have had, we went into the reasons at length in [why Google Analytics feels so complicated](/blog/simple-website-analytics), and compared the main options in our roundup of [Google Analytics alternatives](/blog/google-analytics-alternatives).

The goal is not to collect more data. It is to get answers out of the data you already have.

## What makes a good website analytics tool

When you are choosing between website analytics tools, feature count is a poor guide. These questions are better.

**Can you understand it without training?** Finding your traffic numbers should not require a course.

**Does it show the metrics you need?** More metrics do not mean better analytics. They frequently mean worse, because the ones that matter get buried.

**Is it fast?** The script runs on every page your visitors load. Its weight is your weight.

**Does it respect your visitors?** Ask specifically: cookies or not, identifiers or not, IP addresses stored or not, where the data is held.

**Will it keep up?** The tool should still work when traffic multiplies.

**Can you dig in when you need to?** Custom events, goals, filters and segments matter the moment a simple number raises a question.

**Can you get your data out?** CSV export and an API decide whether the numbers stay usable outside the dashboard, and whether you are locked in.

## How Webyz approaches this

Webyz exists because of the gap between those questions and the answers most tools give.

The overview is one page. Unique visitors, total visits, pageviews, views per visit, bounce rate and visit duration across the top, each with its trend against the previous period and a sentence describing what the graph did. Below that, the breakdowns:

- **Pages**: top pages, entry pages, exit pages
- **Acquisition**: channels, sources, and the full set of UTM parameters
- **Technology**: browsers and versions, operating systems, device types, screen sizes, languages
- **Geography**: countries, regions, cities

Click any row and it becomes a filter, so the whole dashboard narrows to those visitors. Filters live in the URL, which means a filtered view is just a link you can send to someone. A view you keep returning to can be saved as a segment.

Beyond the overview there is realtime, so you can watch a launch as it happens; goals and conversions for the actions that matter; funnels for multi-step paths; journeys for the routes people actually take through the site; custom events with their own properties; scheduled email reports and traffic alerts; public share links for anyone who needs a look without an account; CSV export and a read-only API. Some of these depend on the plan, and the [pricing page](/pricing) lists exactly which.

Underneath, bot traffic is filtered out before it reaches your numbers, using known bot user agents, published datacentre ranges, a referrer spam list and a check for scripted traffic patterns, and the dashboard shows you how much was removed rather than quietly deciding for you.

Webyz is also open source under AGPL-3.0 and self-hostable, so you can read how every number is produced, or run the whole thing on your own server.

The intended experience is short: open the dashboard, understand what happened, decide what to do. Nobody should have to become a data analyst to run a website.

## Analytics should change what you do

Analytics earns its place when it changes a decision.

You publish an article and watch search traffic to it climb over three weeks, so you write two more like it. You launch a landing page and find that almost nobody scrolls as far as the signup form, so you move the form. You ship a product update and see where the spike came from, so you post there again next time. You rewrite the pricing page and conversions go up, so you keep the new version.

Those moments are the return on measuring anything. The dashboard is not the point. Better decisions are.

Whichever platform you use, Google Analytics, Webyz, Plausible, Umami, Matomo or something else, the principle does not change: collect what is useful, understand what it means, act on it.

You do not need to track everything. You need to understand what matters.

## Final thoughts

Website analytics comes down to five questions:

1. Who is visiting?
2. Where are they coming from?
3. What are they looking at?
4. What are they doing?
5. Are they doing what you wanted?

Answer those and you have a solid basis for every decision about your site. Most tools can answer them. The difference is how long it takes you to get the answer, and what the tool collected about your visitors to produce it.

Not the most data. The right data.
