export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  provider?: string;
  createdAt?: string;
};
