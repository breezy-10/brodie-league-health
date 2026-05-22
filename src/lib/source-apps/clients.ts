import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AppSlug =
  | "crm"
  | "facilities"
  | "ref_payroll"
  | "training"
  | "stats_health"
  | "content_health"
  | "ops_schedule";

const ENV_KEYS: Record<AppSlug, { url: string; key: string }> = {
  crm:            { url: "CRM_SUPABASE_URL",            key: "CRM_SUPABASE_SERVICE_ROLE_KEY" },
  facilities:     { url: "FACILITIES_SUPABASE_URL",     key: "FACILITIES_SUPABASE_SERVICE_ROLE_KEY" },
  ref_payroll:    { url: "REF_PAYROLL_SUPABASE_URL",    key: "REF_PAYROLL_SUPABASE_SERVICE_ROLE_KEY" },
  training:       { url: "TRAINING_SUPABASE_URL",       key: "TRAINING_SUPABASE_SERVICE_ROLE_KEY" },
  stats_health:   { url: "STATS_HEALTH_SUPABASE_URL",   key: "STATS_HEALTH_SUPABASE_SERVICE_ROLE_KEY" },
  content_health: { url: "CONTENT_HEALTH_SUPABASE_URL", key: "CONTENT_HEALTH_SUPABASE_SERVICE_ROLE_KEY" },
  ops_schedule:   { url: "OPS_SCHEDULE_SUPABASE_URL",   key: "OPS_SCHEDULE_SUPABASE_SERVICE_ROLE_KEY" },
};

export function sourceClient(slug: AppSlug): SupabaseClient | null {
  const { url, key } = ENV_KEYS[slug];
  const u = process.env[url];
  const k = process.env[key];
  if (!u || !k) return null;
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function sourceConfigured(slug: AppSlug): boolean {
  const { url, key } = ENV_KEYS[slug];
  return !!(process.env[url] && process.env[key]);
}
