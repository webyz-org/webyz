export type Website = {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  userId: string;
  isBlocked: boolean;
  blockedAt: string | null;
  /** False when the plan allows fewer sites than the account has; history kept, no new events. */
  isActive: boolean;
  restrictionReason: string | null;
  isPublic: boolean;
  publicSlug: string | null;
  /** A password stands in front of the share link. The password itself never crosses the wire. */
  hasPassword: boolean;
  /** The signed-in user's relationship to the site. Owners see everything; admins everything but deletion; viewers read only. */
  role: "owner" | "admin" | "viewer";
  createdAt: string;
  updatedAt: string;
};

export type SharedWebsite = {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  /** The page must unlock with a password before analytics reads succeed. */
  hasPassword: boolean;
};

export type ShareState = {
  isPublic: boolean;
  publicSlug: string | null;
  shareUrl: string | null;
  hasPassword: boolean;
};

/** Result of unlocking a password-protected share: send `token` as X-Share-Token. */
export type ShareUnlock = {
  token: string;
  /** Seconds until the token expires. */
  expiresIn: number;
};

export type Goal = {
  id: string;
  websiteId: string;
  name: string;
  eventName: string | null;
  pagePath: string | null;
  createdAt: string;
};
