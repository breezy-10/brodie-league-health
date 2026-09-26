import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../../dashboard/Filters";
import { discountTone, freeTone } from "../rates";
import DiscountTable from "./DiscountTable";
import { loadStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

const BACK_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-surface px-3.5 py-2 text-sm font-medium text-glass-text hover:bg-glass-surface-hover hover:border-glass-gold transition";

const GOLD = "var(--glass-gold)";

type DiscountPlayer = {
  player: string; location: string; currency: string; type: string; team: string | null;
  list_price: number; discount: number; total_paid: number; free: boolean;
  codes: string; discount_names?: string; registered_on: string | null;
  season_team_id?: string | null; player_id?: string | null;
};
type Feed = { season: string; players: DiscountPlayer[]; truncated: boolean };
type TotalsFeed = { locations: { currency: string; regs: number }[] };

// Total registrations in scope — the denominator the players feed can't supply,
// since it only returns rows that carried a discount.
async function loadTotalRegs(season: string, locationNames: string[] | null): Promise<number | null> {
  try {
    const url = new URL("/api/discounts", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as TotalsFeed;
    return (k.locations ?? []).reduce((n, r) => n + (r.regs ?? 0), 0);
  } catch {
    return null;
  }
}

async function loadPlayers(season: string, locationNames: string[] | null, freeOnly: boolean): Promise<Feed | null> {
  try {
    const url = new URL("/api/discounts/players", PROMO_APP_URL);
    url.searchParams.set("season", season);
    if (freeOnly) url.searchParams.set("free", "1");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
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
  searchParams: Promise<{ season?: string; location?: string; free?: string; kind?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, free: freeParam, kind: kindParam } = await searchParams;
  const freeOnly = freeParam === "1";
  // kind=other narrows to the discounts that were neither of the two flat
  // programmes — what the Other discounts tile on the Discounts tab counts.
  const otherOnly = kindParam === "other";
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const { promoLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "registration" },
  );
  const [feed, totalRegs, staff] = await Promise.all([
    loadPlayers(selectedSeason, locationNames, freeOnly),
    loadTotalRegs(selectedSeason, locationNames),
    loadStaff(),
  ]);
  // Same test the feed sorts by, so the cards and the blocks in the table
  // agree on which programme a row belongs to. Returning player wins a tie:
  // a registration carrying both codes is counted once, on the first.
  const isReturning = (r: DiscountPlayer) => /returning player/i.test(r.discount_names ?? "");
  const isReferral = (r: DiscountPlayer) => !isReturning(r) && /referral/i.test(r.discount_names ?? "");
  const allRows = feed?.players ?? [];
  const rows = otherOnly ? allRows.filter((r) => !isReturning(r) && !isReferral(r)) : allRows;
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
    locations: promoLocations,
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
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: GOLD }}>Discounts</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
          {freeOnly ? "Every free registration" : otherOnly ? "Other discounts" : "Every discounted registration"}
        </h1>
        {otherOnly && (
          <p className="text-sm mt-1.5 text-glass-text-tertiary">
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
        // Changing a filter must not quietly widen a free-only list back out.
        keep={freeOnly || otherOnly
          ? { ...(freeOnly ? { free: "1" } : {}), ...(otherOnly ? { kind: "other" } : {}) }
          : undefined}
      />

      {rows.length > 0 && (
        <div className={`grid gap-3 grid-cols-2 ${
          freeOnly ? "md:grid-cols-3" : otherOnly ? "md:grid-cols-4" : "md:grid-cols-3 lg:grid-cols-6"}`}>
          <Tile label="Total registrations" value={totalRegs === null ? "—" : totalRegs.toLocaleString()} />
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
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Discount feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          No {freeOnly ? "free" : otherOnly ? "other discounted" : "discounted"} registrations for {selectedSeason} in this scope.
        </div>
      ) : (
        <DiscountTable rows={rows} season={selectedSeason} staff={staff} />
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
      <span style={{ color: tone(pct), fontWeight: 600 }}>{Math.round(pct)}%</span>
      {" of all registrations"}
    </>
  );
}

function Tile({ label, value, values, sub, accent }: {
  label: string; value?: string; values?: string[]; sub?: React.ReactNode; accent?: string;
}) {
  const figures = values ?? (value === undefined ? [] : [value]);
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
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
