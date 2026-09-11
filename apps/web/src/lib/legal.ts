/**
 * Facts the legal pages need. Webyz is run by an individual during the beta:
 * no company is registered yet, and none is needed until paid plans open
 * (payments require a registered business). When an entity takes over, switch
 * `operator.kind` to "company", set its name and registered address, and the
 * pages update themselves. Placeholders in square brackets render as such, so
 * an unfilled value is visibly unfinished; `reviewed` hides the draft notice
 * once a lawyer has read the pages.
 */
export const LEGAL = {
  operator: {
    kind: "individual" as "individual" | "company",
    /** Full name of the person, or legal name of the company. */
    name: "Nihal",
    /** City, state and country for an individual; the registered address for a company. */
    location: "Kozhikode, Kerala, India",
  },
  /** Country or state whose law governs the terms. */
  jurisdiction: "India",
  /** Where account, privacy and security requests go. A read mailbox, not the sending address. */
  contactEmail: "hello@webyz.io",
  /**
   * Hosting provider and regions for the production database and API.
   * DigitalOcean datacentre names; the operator confirmed the provider and
   * regions on 10 Sep 2026 (an earlier note said AWS, which has no New York or
   * Bangalore region). Name the city for "Europe" once the datacentre is fixed.
   */
  hostingProvider: "DigitalOcean, LLC (datacentres in New York, USA; Bangalore, India; and Europe)",
  /** ISO date the pages were last changed. */
  lastUpdated: "2026-09-10",
  /** True once a lawyer has reviewed the pages; hides the draft notice. */
  reviewed: false,
} as const;

/** "Nihal, an individual based in Kozhikode, Kerala, India" or "Acme Ltd, 1 Example Street, ...". */
export const operatorLine = (): string =>
  LEGAL.operator.kind === "individual"
    ? `${LEGAL.operator.name}, an individual based in ${LEGAL.operator.location}`
    : `${LEGAL.operator.name}, ${LEGAL.operator.location}`;

export const isPlaceholder = (value: string) => value.startsWith("[") && value.endsWith("]");
