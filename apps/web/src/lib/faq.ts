/** Shared by the landing page FAQ and /pricing. Every answer maps to real behaviour. */
export const FAQ = [
  {
    q: "What counts as an event?",
    a: "Every pageview, plus every custom event you send. Bot traffic is filtered before it is counted, and traffic from localhost is never billed, so you are not charged for crawlers or for your own development.",
  },
  {
    q: "What happens if I go over my plan?",
    a: "On the free plan tracking pauses until your period resets, so you never get a surprise invoice. On paid plans the extra events are billed per thousand and your data keeps flowing, up to a monthly spending cap that you set. If you reach the cap, tracking pauses and we tell you, rather than billing past it.",
  },
  {
    q: "Do I need a cookie banner?",
    a: "That depends on your jurisdiction and how you configure the script, so treat this as information rather than legal advice. Webyz sets a single first-party session cookie, respects Do Not Track by default and offers a visitor opt-out.",
  },
  {
    q: "Does Webyz store IP addresses?",
    a: "No. The IP is used once, at ingest, to look up country, region and city, and is not written to the analytics database.",
  },
  {
    q: "Can I self-host instead?",
    a: "Yes. The stack is Postgres, ClickHouse and Redis. Run it on your own servers and none of your traffic data leaves them.",
  },
  {
    q: "Can I cancel whenever?",
    a: "Yes. You keep your plan until the end of the period you have paid for, then drop back to free.",
  },
];
