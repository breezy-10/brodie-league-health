import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam } from "@/lib/seasons";
import { getCanonicalLocations } from "@/lib/districts-locations";
import { getActiveLocationKeys, onlyActive } from "@/lib/active-locations";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { AllGamesBody, gameCounts, loadLiveGames } from "../dashboard/LiveGames";
import AutoRefresh from "./AutoRefresh";
import DayPicker from "./DayPicker";

export default async function LiveGamesView({ searchParams }: { searchParams: Promise<{ location?: string; date?: string }> }) {
  await requireUser();
  const { location: locationParam, date: dateParam } = await searchParams;
  // Today as the head office reads it; any other day is ?date=YYYY-MM-DD.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam !== today ? dateParam : null;
  const day = date ?? today;
  const [y, m, d] = day.split("-").map(Number);
  const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const locationNames = selectedLocations.length ? selectedLocations : null;

  const [canonical, active, games] = await Promise.all([
    getCanonicalLocations(),
    getActiveLocationKeys([]),
    loadLiveGames(locationNames, date),
  ]);
  const options: FilterOptions = { seasons: [], locations: onlyActive(canonical, active, selectedLocations) };
  const asOf = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })
    .format(new Date());
  const n = games ? gameCounts(games) : null;

  return (
    <main className="brodie-fade-in space-y-6">
      {!date && <AutoRefresh />}
      <div className="flex flex-wrap items-end gap-3">
        <Filters key={selectedLocations.join(",")} options={options} current={{ seasons: [], locations: selectedLocations }}
          keep={date ? { date } : undefined} />
        <DayPicker value={day} today={today} />
      </div>

      {!games ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          The Promo Tracker didn&apos;t answer, so today&apos;s schedule can&apos;t be shown.
        </div>
      ) : (
        <>
          <p className="text-sm text-glass-text-secondary">
            <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{date ? dayLabel : `Today, ${dayLabel.split(", ").slice(1).join(", ")}`}</span>
            {" · "}{games.length} {games.length === 1 ? "game" : "games"}
            {!date && (
              <>
                {" · "}<span className="font-semibold" style={{ color: "var(--red)" }}>{n!.live} live</span>
                {" · "}{n!.later} upcoming · {n!.done} done
                <span className="text-glass-text-tertiary"> · as of {asOf} EST, refreshes every minute</span>
              </>
            )}
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
