export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text is always required; HTML is optional but preferred. */
  text: string;
  html?: string;
};

export type EmailTransport = {
  name: string;
  send: (message: EmailMessage) => Promise<void>;
};
