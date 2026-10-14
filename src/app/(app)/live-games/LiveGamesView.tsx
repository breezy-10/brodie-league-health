import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam } from "@/lib/seasons";
import { getCanonicalLocations } from "@/lib/districts-locations";
import { getActiveLocationKeys, onlyActive } from "@/lib/active-locations";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { AllGamesBody, gameCounts, loadLiveGames } from "../dashboard/LiveGames";
import AutoRefresh from "./AutoRefresh";

export default async function LiveGamesView({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  await requireUser();
  const { location: locationParam } = await searchParams;
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const locationNames = selectedLocations.length ? selectedLocations : null;

  const [canonical, active, games] = await Promise.all([
    getCanonicalLocations(),
    getActiveLocationKeys([]),
    loadLiveGames(locationNames),
  ]);
  const options: FilterOptions = { seasons: [], locations: onlyActive(canonical, active, selectedLocations) };
  const asOf = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })
    .format(new Date());
  const n = games ? gameCounts(games) : null;

  return (
    <main className="brodie-fade-in space-y-6">
      <AutoRefresh />
      <Filters key={selectedLocations.join(",")} options={options} current={{ seasons: [], locations: selectedLocations }} />

      {!games ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          The Promo Tracker didn&apos;t answer, so today&apos;s schedule can&apos;t be shown.
        </div>
      ) : (
        <>
          <p className="text-sm text-glass-text-secondary">
            <span className="font-semibold" style={{ color: "var(--red)" }}>{n!.live} live</span>
            {" · "}{n!.later} upcoming today · {n!.done} done
            <span className="text-glass-text-tertiary"> · as of {asOf} ET, refreshes every minute</span>
          </p>
          <AllGamesBody games={games} />
        </>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every game on today&apos;s schedule at each venue, in the venue&apos;s own time. Ops doesn&apos;t track games in
        real time, so a game counts as live through its hour slot and done after it. BallerTV opens the game&apos;s
        stream, or its league&apos;s BallerTV event when the game isn&apos;t listed there yet.
      </p>
    </main>
  );
}
