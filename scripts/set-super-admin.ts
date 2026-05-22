/**
 * Promote a profile to super_admin. Run after the user has signed in once so
 * the auto-created profile row exists.
 *
 * Usage:
 *   npx tsx scripts/set-super-admin.ts amy@brodierec.com
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: tsx scripts/set-super-admin.ts <email>");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("profiles")
    .update({ role: "super_admin", updated_at: new Date().toISOString() })
    .eq("email", email.toLowerCase())
    .select("id, email, role")
    .maybeSingle();
  if (error) {
    console.error("error:", error.message);
    process.exit(1);
  }
  if (!data) {
    console.error(`no profile for ${email}. Sign in once via the web UI first.`);
    process.exit(1);
  }
  console.log(`✅ ${data.email} is now ${data.role}`);
}

main();
