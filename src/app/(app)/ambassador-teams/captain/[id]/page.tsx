import CaptainView from "./CaptainView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// One ambassador's teams for the season: team name, location, night, division
// and roster size. Reached from the Ambassadors table on the roster board.
export default function CaptainPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  return <CaptainView params={params} searchParams={searchParams} />;
}
