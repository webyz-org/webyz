export type ReportFrequency = "weekly" | "monthly";

export type EmailReport = {
  id: string;
  frequency: "WEEKLY" | "MONTHLY";
  recipients: string[];
  /** Exclusive end of the last period sent, or null before the first send. */
  lastPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrafficAlert = {
  id: string;
  threshold: number;
  recipients: string[];
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SiteNotifications = {
  reports: EmailReport[];
  alert: TrafficAlert | null;
};

export type TestReportResult = {
  sent: boolean;
  to: string;
  period: { from: number; to: number; label: string };
};
