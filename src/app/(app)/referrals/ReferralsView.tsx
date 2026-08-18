import { requireUser } from "@/lib/auth";
import { csvParam, loadActiveLMs, locParam, resolveScope } from "@/lib/seasons";
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
  const { season: seasonParam, location: locationParam, lm: lmParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam);
  const selectedLms = csvParam(lmParam);

  const activeLMs = await loadActiveLMs();
  // The filter selects the season this page reports on — no offset. Referrals
  // attach to registrations, so it defaults to the season being registered for
  // rather than the one being played. Terms are stored against the same season.
  const { promoLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations, lms: selectedLms },
    activeLMs,
    { defaultSeason: "registration" },
  );
  const [feed, rates] = await Promise.all([
    loadReferrals(selectedSeason, locationNames),
    loadReferralRates(selectedSeason),
  ]);
  const canEditRates = RATE_EDITOR_ROLES.includes(ctx.profile?.role ?? "");

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: promoLocations,
    lms: activeLMs.map((l) => ({ id: l.id, name: l.full_name || "—" })),
  };
  const rows = feed?.locations ?? [];
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);
  const t = feed?.totals;
  // Referral counts split by the currency they're owed in, so the terms editor
  // can cost the season without inventing an exchange rate.
  const countsByCurrency = new Map<string, CurrencyCounts>();
  for (const r of rows) {
    const c = countsByCurrency.get(r.currency)
      ?? { currency: r.currency, new_athletes: 0, returning_athletes: 0, total: 0, earned: 0 };
    c.new_athletes += r.new_athletes;
    c.returning_athletes += r.returning_athletes;
    c.total += r.total;
    c.earned += r.earned;
    countsByCurrency.set(r.currency, c);
  }
  const currencyCounts = [...countsByCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  const amount = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const currencies = t ? Object.keys(t.earned).sort() : [];
  // What the referred athletes were given off their fee, at the season's stored
  // discount. Ops records the referrer's credit but not the discount, so this
  // side of the cost is derived from the terms rather than read back.
  // New athletes only — the discount comes off a first registration, so a
  // run-it-back earns the referrer $5 but costs nothing in discount.
  const discountFor = (row: { new_athletes: number }) => row.new_athletes * rates.registrant_discount;
  const discountByCurrency: Record<string, number> = {};
  for (const c of currencyCounts) discountByCurrency[c.currency] = c.new_athletes * rates.registrant_discount;
  // Share of referrals that bring in someone who has never registered before.
  // The returning share is derived from it rather than rounded separately, so
  // the two tiles always add to 100 instead of occasionally reading 101.
  const newPct = t && t.total > 0 ? Math.round((100 * t.new_athletes) / t.total) : null;

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: GOLD }}>Referrals</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
          Referral program
        </h1>
      </header>

      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}|${selectedLms.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
          lms: selectedLms,
        }}
      />

      {/* Leads the page: the terms are what the numbers below are measured
          against. Rendered even with no referrals yet, so a season's terms can
          be set before the first one lands. */}
      {/* Keyed by season: the editor holds the typed amounts and the save
          message in local state, which would otherwise survive a season change
          and show one season's terms (and "Saved for …") under another's. */}
      <RatesEditor key={selectedSeason} season={selectedSeason} rates={rates}
        canEdit={canEditRates} counts={currencyCounts} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Referrals</h2>
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: GOLD }}>{selectedSeason}</span>
          </div>
        </div>

        {!feed ? (
          <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
            Referral feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
            No referrals recorded for {selectedSeason} in this scope yet.
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              <Tile label="New athletes" value={t!.new_athletes.toLocaleString()} accent={GOLD}
                sub={newPct === null ? undefined : `${newPct}% of referrals`} />
              <Tile label="Returning athletes" value={t!.returning_athletes.toLocaleString()} accent={RETURNING}
                sub={newPct === null ? undefined : `${100 - newPct}% of referrals`} />
              <Tile label="Confirmed referrals" value={t!.total.toLocaleString()}
                sub={`${t!.recorded.toLocaleString()} recorded`} />
              <Tile label="Referrers" value={t!.referrers.toLocaleString()}
                sub={t!.referrers_exact ? "distinct athletes" : "distinct per location"} />
              {/* Both currencies carry equal weight — neither is a footnote to
                  the other, so they render at the same size. */}
              <Tile label="Earned credit"
                values={currencies.length ? currencies.map((c) => money(t!.earned[c], c)) : ["—"]} />
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
          filter the Registrations tab uses. {feed ? `${feed.totals.recorded.toLocaleString()} referrals were recorded in total for ${selectedSeason}; the difference is drafts, cancellations and failed payments, which earn no credit.` : ""} New
          athletes are first-ever registrations; returning athletes are run-it-backs. Earned credit is what ops actually
          recorded against each referral, owed in each location&apos;s own currency and never summed across the two — it
          can differ from the terms above if those changed mid-season. Discounts are derived from the season&apos;s
          registrant discount ({amount(rates.registrant_discount)} × new athletes — it comes off a first registration,
          so run-it-backs cost nothing in discount), since ops records the referrer&apos;s credit but not the discount.
          Total cost is earned plus discounts.
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

// `values` renders several equally-weighted figures (one per currency); `value`
// is the single-figure case.
function Tile({ label, value, values, sub, accent }: {
  label: string; value?: string; values?: string[]; sub?: string; accent?: string;
}) {
  const figures = values ?? (value === undefined ? [] : [value]);
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 space-y-0.5">
        {figures.map((f, i) => (
          <div key={i} className="text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
            {f}
          </div>
        ))}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
