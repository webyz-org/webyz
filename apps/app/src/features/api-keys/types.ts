export type ApiKey = {
  id: string;
  name: string;
  /** The first characters of the token, all the server keeps in the clear. */
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** The one response that carries the plaintext token. */
export type CreatedApiKey = { key: ApiKey; token: string };
