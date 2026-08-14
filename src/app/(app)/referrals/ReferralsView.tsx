import { requireUser } from "@/lib/auth";
import { loadActiveLMs, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import RatesEditor, { type CurrencyCounts } from "./RatesEditor";
import { loadReferralRates } from "./rates";

// Changing the terms is a money decision — same roles that own app/metric weights.
const RATE_EDITOR_ROLES = ["dm", "super_admin"];

// The Promo Tracker owns the ops-DB (Metabase) connection, so the referral
// numbers come from its feed rather than being re-derived here — same pattern
// as the Registrations tab. Overridable so a local dev server can point at a
// local promo tracker.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type ReferralLocation = {
  location: string;
  currency: string;
  new_athletes: number;
  returning_athletes: number;
  total: number;
  earned: number;
  referrers: number;
  recorded: number;
};
type ReferralFeed = {
  season: string;
  totals: {
    total: number;
    new_athletes: number;
    returning_athletes: number;
    recorded: number;
    referrers: number;
    referrers_exact: boolean;
    earned: Record<string, number>;
  };
  locations: ReferralLocation[];
};

async function loadReferrals(season: string, locationNames: string[] | null): Promise<ReferralFeed | null> {
  try {
    const url = new URL("/api/referrals", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as ReferralFeed;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";
const RETURNING = "#5B8AC4"; // same blue the registration bars use for "prev season"

const money = (n: number, cur: string) => `$${n.toLocaleString("en-US")} ${cur}`;

export default async function ReferralsView({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  const ctx = await requireUser();
  const { season: seasonParam, location = "all", lm = "all" } = await searchParams;

  const activeLMs = await loadActiveLMs();
  const { promoLocations, promoSeasons, selectedSeason, regSeason, locationNames } = await resolveScope(
    { season: seasonParam, location, lm },
    activeLMs,
  );
  // Referrals attach to registrations, which run one season ahead of play —
  // the same season the Registrations tab reports on. The terms are stored
  // against that same registration season.
  const [feed, rates] = await Promise.all([
    loadReferrals(regSeason, locationNames),
    loadReferralRates(regSeason),
  ]);
  const canEditRates = RATE_EDITOR_ROLES.includes(ctx.profile?.role ?? "");

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: promoLocations,
    lms: activeLMs.map((l) => ({ id: l.id, name: l.full_name || "—" })),
  };
  const scopeLabel =
    lm !== "all" ? (activeLMs.find((l) => l.id === lm)?.full_name ?? "1 league manager")
    : location !== "all" ? location
    : `all ${activeLMs.length} league managers`;

  const rows = feed?.locations ?? [];
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);
  const t = feed?.totals;
  // Referral counts split by the currency they're owed in, so the terms editor
  // can cost the season without inventing an exchange rate.
  const countsByCurrency = new Map<string, CurrencyCounts>();
  for (const r of rows) {
    const c = countsByCurrency.get(r.currency)
      ?? { currency: r.currency, new_athletes: 0, returning_athletes: 0, total: 0 };
    c.new_athletes += r.new_athletes;
    c.returning_athletes += r.returning_athletes;
    c.total += r.total;
    countsByCurrency.set(r.currency, c);
  }
  const currencyCounts = [...countsByCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  const amount = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const currencies = t ? Object.keys(t.earned).sort() : [];
  // What the referred athletes were given off their fee, at the season's stored
  // discount. Ops records the referrer's credit but not the discount, so this
  // side of the cost is derived from the terms rather than read back.
  const discountFor = (row: { total: number }) => row.total * rates.registrant_discount;
  const discountByCurrency: Record<string, number> = {};
  for (const c of currencyCounts) discountByCurrency[c.currency] = c.total * rates.registrant_discount;
  // Share of referrals that bring in someone who has never registered before.
  const newPct = t && t.total > 0 ? Math.round((100 * t.new_athletes) / t.total) : null;

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: GOLD }}>Referrals</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
          Referral program
        </h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Athletes brought in by the invite code for {scopeLabel}, split into new athletes
          ({amount(rates.new_athlete_payment)}) and run-it-backs ({amount(rates.returning_athlete_payment)}).
        </p>
      </header>

      <Filters key={`${selectedSeason}|${location}|${lm}`} options={options} current={{ season: selectedSeason, location, lm }} />

      {/* Leads the page: the terms are what the numbers below are measured
          against. Rendered even with no referrals yet, so a season's terms can
          be set before the first one lands. */}
      <RatesEditor season={regSeason} rates={rates} canEdit={canEditRates} counts={currencyCounts} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Referrals</h2>
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: GOLD }}>{regSeason}</span>
          </div>
        </div>

        {!feed ? (
          <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
            Referral feed unavailable — the Promo Tracker didn&apos;t answer for {regSeason}.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
            No referrals recorded for {regSeason} in this scope yet.
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              <Tile label="New athletes" value={t!.new_athletes.toLocaleString()} accent={GOLD}
                sub={newPct === null ? undefined : `${newPct}% of referrals`} />
              <Tile label="Returning athletes" value={t!.returning_athletes.toLocaleString()} accent={RETURNING}
                sub="run-it-backs" />
              <Tile label="Confirmed referrals" value={t!.total.toLocaleString()}
                sub={`${t!.recorded.toLocaleString()} recorded`} />
              <Tile label="Referrers" value={t!.referrers.toLocaleString()}
                sub={t!.referrers_exact ? "distinct athletes" : "distinct per location"} />
              <Tile label="Earned credit"
                value={currencies.length ? money(t!.earned[currencies[0]], currencies[0]) : "—"}
                sub={currencies.slice(1).map((c) => money(t!.earned[c], c)).join(" · ") || undefined} />
            </div>

            <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 860 }}>
                  <thead>
                    <tr className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
                      <Th align="left">League</Th>
                      <Th>New</Th>
                      <Th>Returning</Th>
                      <Th>Total</Th>
                      <Th>Earned</Th>
                      <Th>Discounts</Th>
                      <Th>Total cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                        <td className="px-4 py-2.5 align-middle">
                          <div className="font-semibold truncate" style={{ color: "var(--glass-text)" }} title={r.location}>
                            {r.location}
                          </div>
                          {/* Bar length = share of the busiest location; the gold
                              segment is new athletes, so mix and volume read at once. */}
                          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden flex"
                            style={{ width: `${Math.max((r.total / maxTotal) * 100, 2)}%`, minWidth: 8 }}
                            title={`${r.new_athletes} new · ${r.returning_athletes} returning`}>
                            <span style={{ width: `${r.total ? (r.new_athletes / r.total) * 100 : 0}%`, background: GOLD }} />
                            <span style={{ width: `${r.total ? (r.returning_athletes / r.total) * 100 : 0}%`, background: RETURNING }} />
                          </div>
                        </td>
                        <Td strong color={GOLD}>{r.new_athletes.toLocaleString()}</Td>
                        <Td>{r.returning_athletes.toLocaleString()}</Td>
                        <Td>{r.total.toLocaleString()}</Td>
                        <Td>{money(r.earned, r.currency)}</Td>
                        <Td>{money(discountFor(r), r.currency)}</Td>
                        <Td strong>{money(r.earned + discountFor(r), r.currency)}</Td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                      <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }}>Total</td>
                      <Td strong color={GOLD}>{t!.new_athletes.toLocaleString()}</Td>
                      <Td strong>{t!.returning_athletes.toLocaleString()}</Td>
                      <Td strong>{t!.total.toLocaleString()}</Td>
                      <TotalMoney>{currencies.map((c) => money(t!.earned[c], c)).join(" · ")}</TotalMoney>
                      <TotalMoney>{currencies.map((c) => money(discountByCurrency[c] ?? 0, c)).join(" · ")}</TotalMoney>
                      <TotalMoney>
                        {currencies.map((c) => money(t!.earned[c] + (discountByCurrency[c] ?? 0), c)).join(" · ")}
                      </TotalMoney>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <p className="text-xs text-glass-text-tertiary">
          Counts only referrals whose registration went through (completed, not cancelled, paid or paying) — the same
          filter the Registrations tab uses. {feed ? `${feed.totals.recorded.toLocaleString()} referrals were recorded in total for ${regSeason}; the difference is drafts, cancellations and failed payments, which earn no credit.` : ""} New
          athletes are first-ever registrations; returning athletes are run-it-backs. Earned credit is what ops actually
          recorded against each referral, owed in each location&apos;s own currency and never summed across the two — it
          can differ from the terms above if those changed mid-season. Discounts are derived from the season&apos;s
          registrant discount ({amount(rates.registrant_discount)} × referrals), since ops records the referrer&apos;s
          credit but not the discount; total cost is earned plus discounts.
        </p>
      </section>
    </main>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`}>{children}</th>
  );
}

// Totals-row money cell: each currency stays its own figure, never summed.
function TotalMoney({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
      {children || "—"}
    </td>
  );
}

function Td({ children, strong = false, color }: { children: React.ReactNode; strong?: boolean; color?: string }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
      style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>
      {children}
    </td>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular" style={{ color: accent ?? "var(--glass-text)" }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
