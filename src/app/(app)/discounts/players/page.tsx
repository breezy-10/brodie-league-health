import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../../dashboard/Filters";
import { discountTone, freeTone } from "../rates";
import DiscountTable from "./DiscountTable";
import { BasisToggle } from "../../dashboard/BasisToggle";
import { loadStaff } from "@/lib/staff";
import { promoFetch } from "@/lib/promo-feed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

const BACK_BTN =
  "inline-flex items-center gap-1.5 rounded-full bg-[color:var(--fill-3)] px-3.5 py-2 text-sm font-semibold text-glass-text hover:bg-glass-surface-hover hover:border-glass-gold transition";

const GOLD = "var(--glass-gold)";

type DiscountPlayer = {
  player: string; location: string; currency: string; type: string; team: string | null;
  list_price: number; discount: number; total_paid: number; free: boolean;
  codes: string; discount_names?: string; registered_on: string | null;
  season_team_id?: string | null; player_id?: string | null;
};
// unrostered: every free agent not yet on a team, discounted or not (asked
// for in team view only).
type Feed = { season: string; players: DiscountPlayer[]; truncated: boolean; unrostered?: DiscountPlayer[] };
type TotalsFeed = { locations: { currency: string; regs: number }[] };

// Total registrations in scope — the denominator the players feed can't supply,
// since it only returns rows that carried a discount.
async function loadTotalRegs(season: string, locationNames: string[] | null): Promise<number | null> {
  try {
    const url = new URL("/api/discounts", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as TotalsFeed;
    return (k.locations ?? []).reduce((n, r) => n + (r.regs ?? 0), 0);
  } catch {
    return null;
  }
}

// Teams registered in scope, from the Promo Tracker's KPI feed: registered,
// active and not deleted in the ops DB, the dashboard's Total teams basis.
async function loadTeamCount(season: string, locationNames: string[] | null): Promise<number | null> {
  try {
    const url = new URL("/api/dashboard-kpis", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { teams_registered?: number };
    return typeof k.teams_registered === "number" ? k.teams_registered : null;
  } catch {
    return null;
  }
}

async function loadPlayers(season: string, locationNames: string[] | null, freeOnly: boolean, unrostered = false): Promise<Feed | null> {
  try {
    const url = new URL("/api/discounts/players", PROMO_APP_URL);
    url.searchParams.set("season", season);
    if (freeOnly) url.searchParams.set("free", "1");
    if (unrostered) url.searchParams.set("unrostered", "1");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Feed;
    return k.players ? k : null;
  } catch {
    return null;
  }
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function DiscountPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; free?: string; kind?: string; view?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, free: freeParam, kind: kindParam, view: viewParam } = await searchParams;
  // Player view lists registrations; team view shows the teams they're on.
  const teamView = viewParam === "teams";
  const freeOnly = freeParam === "1";
  // kind=other narrows to the discounts that were neither of the two flat
  // programmes — what the Other discounts tile on the Discounts tab counts.
  const otherOnly = kindParam === "other";
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const { filterLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "registration" },
  );
  const [feed, totalRegs, staff, teamCount] = await Promise.all([
    loadPlayers(selectedSeason, locationNames, freeOnly, teamView),
    loadTotalRegs(selectedSeason, locationNames),
    loadStaff(),
    loadTeamCount(selectedSeason, locationNames),
  ]);
  // Same test the feed sorts by, so the cards and the blocks in the table
  // agree on which programme a row belongs to. Returning player wins a tie:
  // a registration carrying both codes is counted once, on the first.
  const isReturning = (r: DiscountPlayer) => /returning player/i.test(r.discount_names ?? "");
  const isReferral = (r: DiscountPlayer) => !isReturning(r) && /referral/i.test(r.discount_names ?? "");
  const allRows = feed?.players ?? [];
  const rows = otherOnly ? allRows.filter((r) => !isReturning(r) && !isReferral(r)) : allRows;
  // Team view's last block: free agents not on a team yet, whatever they paid
  // — narrowed like the list when it is free-only or other-only — plus any
  // discounted registration without a team that isn't a free agent.
  const unrosteredRows = (() => {
    if (!teamView) return [];
    const fa = (feed?.unrostered ?? []).filter((r) =>
      freeOnly ? r.free : otherOnly ? r.discount > 0 && !isReturning(r) && !isReferral(r) : true);
    const seen = new Set(fa.map((r) => r.player_id));
    return [...fa, ...rows.filter((r) => !r.season_team_id && !seen.has(r.player_id ?? null))];
  })();
  const free = rows.filter((r) => r.free).length;
  const returning = rows.filter(isReturning).length;
  const referral = rows.filter(isReferral).length;
  // What each programme cost, reported per currency like the Given up card —
  // a CAD figure and a USD figure are never added together.
  const givenUp = (pred: (r: DiscountPlayer) => boolean) => {
    const m = new Map<string, number>();
    for (const r of rows) if (pred(r)) m.set(r.currency, (m.get(r.currency) ?? 0) + r.discount);
    return [...m.entries()].sort().map(([c, v]) => `${money(v)} ${c}`).join(" \u00b7 ");
  };
  // Currencies are never summed; the total is reported once per currency.
  const totalByCurrency = new Map<string, number>();
  for (const r of rows) totalByCurrency.set(r.currency, (totalByCurrency.get(r.currency) ?? 0) + r.discount);

  // Carry the filters back to the tab that linked here.
  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
  };

  const back = new URLSearchParams();
  if (seasonParam) back.set("season", seasonParam);
  if (locationParam) back.set("location", locationParam);
  const backHref = `/discounts${back.toString() ? `?${back}` : ""}`;

  return (
    <main className="brodie-fade-in space-y-6">
      <div>
        <Link href={backHref} className={BACK_BTN}>← Discounts</Link>
      </div>

      <header>
        <h2 className="page-h2">
          {freeOnly ? "Every free registration" : otherOnly ? "Other discounts" : "Every discounted registration"}
        </h2>
        {otherOnly && (
          <p className="page-lede mt-1">
            Every discounted registration that wasn&apos;t the returning-player discount or a referral.
          </p>
        )}
      </header>

      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
        }}
        // Changing a filter must not quietly widen a free-only list back out,
        // or drop back to player view.
        keep={freeOnly || otherOnly || teamView
          ? { ...(freeOnly ? { free: "1" } : {}), ...(otherOnly ? { kind: "other" } : {}), ...(teamView ? { view: "teams" } : {}) }
          : undefined}
      />

      <BasisToggle
        param="view"
        value={teamView ? "teams" : "players"}
        options={[{ value: "players", label: "Player view" }, { value: "teams", label: "Team view" }]}
      />

      {rows.length > 0 && (
        <div className={`grid gap-3 grid-cols-2 ${
          freeOnly ? "md:grid-cols-3" : otherOnly ? "md:grid-cols-4" : "md:grid-cols-3 lg:grid-cols-6"}`}>
          <Tile label="Total registrations" value={totalRegs === null ? "—" : totalRegs.toLocaleString()}
            sub={teamCount === null ? undefined : `${teamCount.toLocaleString()} team${teamCount === 1 ? "" : "s"}`} />
          <Tile label={freeOnly ? "Free registrations" : otherOnly ? "Other discounts" : "Discounted registrations"}
            value={rows.length.toLocaleString()} accent={freeOnly ? GOLD : undefined}
            sub={totalRegs ? <Pct n={rows.length} of={totalRegs} tone={freeOnly ? freeTone : discountTone} /> : undefined} />
          {!freeOnly && !otherOnly && (
            <>
              <Tile label="Returning player" value={returning.toLocaleString()}
                sub={<Sub pct={totalRegs ? <Pct n={returning} of={totalRegs} tone={discountTone} /> : null}
                  cost={givenUp(isReturning)} />} />
              <Tile label="Referral" value={referral.toLocaleString()}
                sub={<Sub pct={totalRegs ? <Pct n={referral} of={totalRegs} tone={discountTone} /> : null}
                  cost={givenUp(isReferral)} />} />
            </>
          )}
          {!freeOnly && (
            <Tile label="Free" value={free.toLocaleString()} accent={GOLD}
              sub={totalRegs ? <Pct n={free} of={totalRegs} tone={freeTone} /> : undefined} />
          )}
          {/* Never summed across currencies — each is its own figure. */}
          <Tile label="Given up"
            values={[...totalByCurrency.entries()].sort().map(([c, v]) => `${money(v)} ${c}`)} />
        </div>
      )}

      {!feed ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Discount feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No {freeOnly ? "free" : otherOnly ? "other discounted" : "discounted"} registrations for {selectedSeason} in this scope.
        </div>
      ) : (
        <DiscountTable key={teamView ? "teams" : "players"} rows={rows} season={selectedSeason} staff={staff} teamView={teamView}
          unrostered={unrosteredRows} />
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every registration in {selectedSeason} that {freeOnly
          ? "paid nothing"
          : otherOnly
            ? "carried a discount other than the returning-player discount or a referral"
            : "carried a discount"}, largest first — the same scope as the
        Discounts tab, so the count here matches the &ldquo;{freeOnly ? "free" : otherOnly ? "other discounts" : "got a discount"}&rdquo; tile. A code that has since been
        deleted takes its usage records with it, so a registration can carry a discount with nothing left to name it;
        those show as <span className="font-mono">(code removed)</span> rather than being dropped, because the money
        still came off. {feed?.truncated ? "Only the first 2,000 rows are shown." : ""}
      </p>
    </main>
  );
}

// A rate with its band colour, for a card's sub-label.
// Share of registrations on one line, what the programme gave up on the next.
function Sub({ pct, cost }: { pct: React.ReactNode; cost: string }) {
  return (
    <>
      {pct}
      {pct && cost ? <br /> : null}
      {cost ? `${cost} given up` : null}
    </>
  );
}
function Pct({ n, of, tone }: { n: number; of: number; tone: (pct: number) => string }) {
  const pct = of ? (100 * n) / of : 0;
  return (
    <>
      {/* The count beside the share — 15% says how big, "6 of 40" says of what. */}
      <span style={{ color: tone(pct), fontWeight: 600 }}>{Math.round(pct)}%</span>
      {" · "}
      <span className="tabular">{n.toLocaleString()} of {of.toLocaleString()}</span>
      {" registrations"}
    </>
  );
}

function Tile({ label, value, values, sub, accent }: {
  label: string; value?: string; values?: string[]; sub?: React.ReactNode; accent?: string;
}) {
  const figures = values ?? (value === undefined ? [] : [value]);
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 space-y-0.5">
        {(figures.length ? figures : ["—"]).map((f, i) => (
          <div key={i} className="text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
            {f}
          </div>
        ))}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
