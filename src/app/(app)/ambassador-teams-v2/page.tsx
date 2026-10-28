import { requireRole } from "@/lib/auth";
import AmbassadorTeamsView from "../ambassador-teams/AmbassadorTeamsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Ambassador teams v2: the Ambassador teams page with each location row
// opening onto its nights and team cards, on trial in the sidebar before it
// replaces the original. Super admins only, like its sidebar link: anyone else
// who has the address is sent home.
export default async function AmbassadorTeamsV2Page({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  await requireRole(["super_admin"]);
  return <AmbassadorTeamsView searchParams={searchParams} v2 />;
}
