export type FunnelStep = {
  id: string;
  position: number;
  label: string;
  eventName: string | null;
  pagePath: string | null;
};

export type Funnel = {
  id: string;
  name: string;
  steps: FunnelStep[];
};

export type FunnelMetric = "visitors" | "sessions";

export type FunnelStepInput = {
  label?: string;
  eventName?: string;
  pagePath?: string;
};

export type FunnelInput = {
  name: string;
  steps: FunnelStepInput[];
};

export type FunnelAnalysisStep = {
  position: number;
  label: string;
  event_name: string | null;
  page_path: string | null;
  visitors: number;
  sessions: number;
  /** Of the selected metric, vs step 1. */
  conversion_rate: number;
  /** Of the selected metric, lost vs the previous step. */
  drop_off: number;
};

export type FunnelAnalysis = {
  funnel: { id: string; name: string };
  metric: FunnelMetric;
  entered: number;
  completed: number;
  conversion_rate: number;
  steps: FunnelAnalysisStep[];
};

export type GoalDetailResponse = {
  goal: {
    id: string;
    name: string;
    event_name: string | null;
    page_path: string | null;
  };
  totals: {
    visitors: number;
    completions: number;
    total_visitors: number;
    conversion_rate: number;
  };
  trend: { labels: string[]; plot: number[]; interval: string };
  sources: Array<{ name: string; visitors: number; percentage: number }>;
  devices: Array<{ name: string; visitors: number; percentage: number }>;
  countries: Array<{ name: string; visitors: number; percentage: number }>;
};
