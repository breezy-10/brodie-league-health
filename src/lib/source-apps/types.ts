import type { AppSlug } from "./clients";

export type Severity = "low" | "medium" | "high" | "critical";

export type ActionItem = {
  metric_slug: string;
  title: string;
  detail?: string;
  severity: Severity;
  source_ref?: string;
};

export type MetricResult = {
  metric_slug: string;
  raw_value: number;
  max_score: number;
  score: number;
  payload?: Record<string, unknown>;
};

export type LMRollup = {
  lm_email: string;
  location_name?: string;
  metrics: MetricResult[];
  action_items: ActionItem[];
};

export type AdapterResult = {
  slug: AppSlug;
  rollups: LMRollup[];
  unconfigured?: boolean;
  error?: string;
};

export interface Adapter {
  slug: AppSlug;
  sync(snapshotDate: Date): Promise<AdapterResult>;
}
