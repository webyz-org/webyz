export type WebsiteRole = "ADMIN" | "VIEWER";

export type MemberUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type Member = {
  id: string;
  role: WebsiteRole;
  createdAt: string;
  user: MemberUser;
};

export type Invitation = {
  id: string;
  email: string;
  role: WebsiteRole;
  expiresAt: string;
  createdAt: string;
};

export type MembersResponse = {
  /** The caller's own relationship to the site. */
  role: "owner" | "admin" | "viewer";
  owner: MemberUser | null;
  members: Member[];
  invitations: Invitation[];
  seats: { limit: number; used: number; planName: string };
};

export type InvitationDetails = {
  email: string;
  role: WebsiteRole;
  site: { name: string; domain: string };
  invitedBy: string;
  expiresAt: string;
  expired: boolean;
};

export type AcceptResult = {
  websiteId: string;
  domain: string;
  role: WebsiteRole | "OWNER";
};
