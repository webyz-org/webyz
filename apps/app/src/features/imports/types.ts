export type ImportStatus = "pending" | "running" | "completed" | "failed";

export type SiteImport = {
  id: string;
  source: "ga4" | "csv";
  property_id: string;
  property_name: string | null;
  start_date: string;
  end_date: string;
  status: ImportStatus;
  steps_done: number;
  steps_total: number;
  rows_imported: number;
  /** Reports the property could not serve. */
  skipped: string[];
  /** GA4 data left out on purpose, with the reason. */
  not_imported: string[];
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export type Ga4Property = { id: string; name: string; account: string };

export type ImportConnection = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  properties: Ga4Property[];
};

export type SiteExport = {
  id: string;
  filename: string;
  status: "running" | "completed" | "failed";
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
};
