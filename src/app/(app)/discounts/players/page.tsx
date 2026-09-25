import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

const BACK_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-surface px-3.5 py-2 text-sm font-medium text-glass-text hover:bg-glass-surface-hover hover:border-glass-gold transition";

const GOLD = "var(--glass-gold)";

type DiscountPlayer = {
  player: string; location: string; currency: string; type: string; team: string | null;
  list_price: number; discount: number; total_paid: number; free: boolean;
  codes: string; registered_on: string | null;
};
type Feed = { season: string; players: DiscountPlayer[]; truncated: boolean };

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
const TYPE_LABEL: Record<string, string> = { captain: "Captain", join_team: "Join team", free_agent: "Free agent" };
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "—";

export default async function DiscountPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; free?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, free: freeParam } = await searchParams;
  const freeOnly = freeParam === "1";
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const { selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "registration" },
  );
  const feed = await loadPlayers(selectedSeason, locationNames, freeOnly);
  const rows = feed?.players ?? [];
  const free = rows.filter((r) => r.free).length;
  // Currencies are never summed; the total is reported once per currency.
  const totalByCurrency = new Map<string, number>();
  for (const r of rows) totalByCurrency.set(r.currency, (totalByCurrency.get(r.currency) ?? 0) + r.discount);

  // Carry the filters back to the tab that linked here.
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
          {freeOnly ? "Every free registration" : "Every discounted registration"}
        </h1>
        <p className="text-sm mt-1.5 text-glass-text-tertiary max-w-[70ch]">
          {selectedSeason}
          {selectedLocations.length ? ` · ${selectedLocations.join(", ")}` : ""}
        </p>
      </header>

      {rows.length > 0 && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
          <Tile label={freeOnly ? "Free registrations" : "Discounted registrations"}
            value={rows.length.toLocaleString()} accent={freeOnly ? GOLD : undefined} />
          {!freeOnly && (
            <Tile label="Free" value={free.toLocaleString()} accent={GOLD}
              sub={rows.length ? `${Math.round((100 * free) / rows.length)}% of them paid nothing` : undefined} />
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
          No {freeOnly ? "free" : "discounted"} registrations for {selectedSeason} in this scope.
        </div>
      ) : (
        <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 960 }}>
              <thead>
                <tr className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
                  <Th align="left">Player</Th>
                  <Th align="left">Location</Th>
                  <Th align="left">Type</Th>
                  <Th align="left">Team</Th>
                  <Th align="left">Code</Th>
                  <Th>List price</Th>
                  <Th>Discount</Th>
                  <Th>Total price</Th>
                  <Th>Registered</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.player}-${r.team ?? ""}-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                      {r.player}
                      {r.free && (
                        <span className="ml-2 text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded align-middle"
                          style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: GOLD }}>Free</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{r.location}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-glass-text-tertiary">{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td className="px-4 py-2.5 max-w-[220px] truncate" style={{ color: "var(--glass-text)" }} title={r.team ?? ""}>
                      {r.team ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] whitespace-nowrap text-glass-text-tertiary" title={r.codes}>
                      {r.codes}
                    </td>
                    <Td>{money(r.list_price)}</Td>
                    <Td strong color={GOLD}>−{money(r.discount)}</Td>
                    <Td>{money(r.total_paid)}</Td>
                    <Td>{day(r.registered_on)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every registration in {selectedSeason} that {freeOnly ? "paid nothing" : "carried a discount"}, largest first — the same scope as the
        Discounts tab, so the count here matches the &ldquo;got a discount&rdquo; tile. A code that has since been
        deleted takes its usage records with it, so a registration can carry a discount with nothing left to name it;
        those show as <span className="font-mono">(code removed)</span> rather than being dropped, because the money
        still came off. {feed?.truncated ? "Only the first 2,000 rows are shown." : ""}
      </p>
    </main>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`}>{children}</th>;
}

function Tile({ label, value, values, sub, accent }: {
  label: string; value?: string; values?: string[]; sub?: string; accent?: string;
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

function Td({ children, strong = false, color }: { children: React.ReactNode; strong?: boolean; color?: string }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
      style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>
      {children}
    </td>
  );
}
