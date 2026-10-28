import AmbassadorTeamsView from "../ambassador-teams/AmbassadorTeamsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Ambassador teams v2: the Ambassador teams page with each location row
// opening onto its nights and team cards, on trial in the sidebar before it
// replaces the original.
export default function AmbassadorTeamsV2Page({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  return <AmbassadorTeamsView searchParams={searchParams} v2 />;
}
