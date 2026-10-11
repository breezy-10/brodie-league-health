import DropInsView from "./DropInsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Drop-ins tab: players who came for a single game. Overview has the season's
// figures per location; Scheduled lists each drop-in by the game it is for.
export default function DropInsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; tab?: string; when?: string }>;
}) {
  return <DropInsView searchParams={searchParams} />;
}
