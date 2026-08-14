import AmbassadorTeamsView from "./AmbassadorTeamsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Ambassador teams tab — every ambassador team for the season by location and
// night, with its captain and roster size, using the same Season / Location /
// League manager filters as the other tabs.
export default function AmbassadorTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  return <AmbassadorTeamsView searchParams={searchParams} />;
}
