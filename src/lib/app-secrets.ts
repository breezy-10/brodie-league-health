import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Secrets stored in League Health's own database (table app_secrets; RLS on,
// no policies, so only the service role reads them). Used where a value can't
// be put in Vercel settings. Cached briefly per server instance.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string | null; at: number }>();

export async function readAppSecret(name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const { data, error } = await createAdminClient()
      .from("app_secrets").select("value").eq("name", name).maybeSingle();
    const value = error ? null : ((data as { value: string } | null)?.value ?? null);
    cache.set(name, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}
