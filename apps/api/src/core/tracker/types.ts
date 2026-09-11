export type EventInput = {
  websiteId: string;
  sessionId: string;
  userId: string;
  eventType: "pageview" | "event" | "engagement";
  eventName: string;
  /** Only on engagement: visible time since the last report, deepest scroll so far. */
  engagement?: { ms: number; scrollDepth: number };
  timestamp: Date;
  hostname: string;
  url: {
    path: string;
    query: string;
    referrerPath: string;
    referrerQuery: string;
    referrerDomain: string;
  };
  page: {
    title: string;
    screen: string;
    language: string;
  };
  client: {
    ip: string;
    deviceType: string;
  };
  userAgent: {
    browser: string;
    os: string;
  };
  geo: {
    country: string;
    subdivision1: string;
    subdivision2: string;
    city: string;
  };
  utm: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  meta: {
    keys: string[];
    values: string[];
  };
};

export type SessionUAInfo = {
  browserFamily: string;
  browserVersion: string;
  osFamily: string;
  osVersion: string;
  deviceType: string;
  deviceBrand: string;
}

export type SessionData = {
  sessionId: string;
  websiteId: string;
  userId: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  entryPage: string;
  exitPage: string;
  pageViews: number;
  events: number;
  // Visible time and deepest scroll reported by engagement events, summed
  // and maxed over the session; carried forward like every other column.
  engagedSeconds: number;
  scrollDepth: number;
  hostname: string;
  browserFamily: string;
  browserVersion: string;
  osFamily: string;
  osVersion: string;
  deviceType: string;
  deviceBrand: string;
  // Screen resolution and browser language of the first pageview; carried
  // forward like every other session column.
  screen: string;
  language: string;
  country: string;
  subdivision1: string;
  subdivision2: string;
  city: string;
  // Acquisition attribution. First-touch: set when the session is created and
  // carried forward on every later pageview in the same session.
  channel: string;
  referrerDomain: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
};

export type EventData = {
  eventId: string;
  websiteId: string;
  sessionId: string;
  userId: string;
  eventType: string;
  eventName: string;
  timestamp: Date;
  urlPath: string;
  urlQuery: string;
  referrerPath: string;
  referrerQuery: string;
  referrerDomain: string;
  pageTitle: string;
  hostname: string;
  browser: string;
  os: string;
  deviceType: string;
  screen: string;
  language: string;
  country: string;
  subdivision1: string;
  subdivision2: string;
  city: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  metaKeys: string[];
  metaValues: string[];
};
