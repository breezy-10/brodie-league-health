import { requireRole } from "@/lib/auth";
import { loadStaffRoster } from "@/lib/staff-roster";
import { getActiveLocationKeys } from "@/lib/active-locations";
import StaffTable from "./StaffTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Training's older names for venues ops has since renamed, so the location
// filter can tell they're running.
const TRAINING_ALIASES: Record<string, string> = {
  "brampton (game6)": "Brampton",
  "new jersey": "New Jersey (Mountainside)",
};
// Not a league venue, so never hidden from the filter.
const ALWAYS_LISTED = new Set(["hq"]);

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// Staff performance — every staff member from the Training app with their role
// and venues, each rated 0 to 10. Admins and district managers only.
export default async function StaffPerformancePage() {
  await requireRole(["super_admin", "dm"]);
  const [{ staff, ratingsReady }, active] = await Promise.all([loadStaffRoster(), getActiveLocationKeys([])]);

  // The location filter lists only venues with a captain this season or next,
  // like every other location filter. Staff elsewhere still show under All.
  const venues = [...new Set((staff ?? []).flatMap((s) => s.locations))].sort((a, b) => a.localeCompare(b));
  const locationOptions = active
    ? venues.filter((v) => ALWAYS_LISTED.has(v.toLowerCase()) || active.has(key(TRAINING_ALIASES[v.toLowerCase()] ?? v)))
    : venues;

  return (
    <main className="brodie-fade-in space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>Staff</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>Staff performance</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Everyone in the Training app, with their role and locations. Rate each person from 0 to 10.
        </p>
      </div>
      {staff === null ? (
        <p className="text-sm rounded-2xl border border-glass-border bg-glass-surface px-5 py-4 text-glass-text-secondary">
          Not connected: the Training app couldn&apos;t be read, so there&apos;s no staff list to show.
        </p>
      ) : (
        <StaffTable staff={staff} locationOptions={locationOptions} ratingsReady={ratingsReady} />
      )}
    </main>
  );
}
