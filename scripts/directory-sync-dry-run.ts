/**
 * Print what the directory sync would change in the league_managers roster,
 * writing nothing (DIRECTORY_SYNC is ignored here: always a dry run).
 *
 *   set -a && source .env.local && set +a && npx tsx scripts/directory-sync-dry-run.ts
 */
import { describeRosterSync, syncRosterFromDirectory } from "@/lib/roster";

async function main() {
  const result = await syncRosterFromDirectory({ dryRun: true });
  console.log(describeRosterSync(result));
  if (!result.ok) process.exit(1);
}
main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
