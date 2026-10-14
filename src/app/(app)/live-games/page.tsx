import LiveGamesView from "./LiveGamesView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Live games: every game on today's schedule at each venue, live, upcoming
// and done, with a BallerTV link on each.
export default function LiveGamesPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  return <LiveGamesView searchParams={searchParams} />;
}
