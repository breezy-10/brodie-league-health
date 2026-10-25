import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";

// Expansion waitlists: every market ops has opened a waitlist for, how many
// people put down a deposit to be first in, how many started and didn't pay,
// and how many are new to Brodie. Markets aren't locations yet, so there's no
// season or location filter. The Promo Tracker owns the ops-DB connection.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type WaitlistRow = {
  market: string;
  status: string;
  launch: string | null;
  launch_start: string | null;
  opened_on: string | null;
  signed_up: number;
  started: number;
  cancelled: number;
  new_to_brodie: number;
  deposits: number;
  currency: string | null;
  latest_signup: string | null;
};

async function loadWaitlist(): Promise<WaitlistRow[] | null> {
  try {
    const res = await promoFetch(new URL("/api/waitlist", PROMO_APP_URL).toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { markets?: WaitlistRow[] };
    return Array.isArray(k.markets) ? k.markets : null;
  } catch {
    return null;
  }
}

// Every amount names its currency ("$50.00 USD", "$50.00 CAD"): the markets mix both.
const money = (n: number, cur: string) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");
// "2026-10-12" read as a date, not through Date in the viewer's zone.
function shortDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const STATUS: Record<string, { label: string; style: React.CSSProperties }> = {
  open: { label: "Open", style: { color: "var(--green)", background: "var(--green-tint)" } },
  draft: { label: "Draft", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
  closed: { label: "Closed", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
};

export default async function WaitlistView() {
  await requireUser();
  return <WaitlistBody />;
}

// The page itself, apart from the sign-in check.
export async function WaitlistBody() {
  const rows = await loadWaitlist();

  if (!rows) {
    return (
      <main className="brodie-fade-in space-y-6">
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Waitlist feed unavailable: the Promo Tracker didn&apos;t answer.
        </div>
      </main>
    );
  }

  // Most sign-ups first, then most started, then by name.
  const markets = [...rows].sort((a, b) =>
    b.signed_up - a.signed_up || b.started - a.started || a.market.localeCompare(b.market));
  const sum = (k: "signed_up" | "started" | "new_to_brodie") => rows.reduce((s, r) => s + r[k], 0);
  const signedUp = sum("signed_up"), started = sum("started"), newToBrodie = sum("new_to_brodie");
  const open = rows.filter((r) => r.status === "open").length;
  const withSignups = rows.filter((r) => r.signed_up > 0).length;
  // Each currency on its own, never summed together.
  const byCurrency = new Map<string, number>();
  for (const r of rows) if (r.deposits && r.currency) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.deposits);
  const deposits = [...byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <main className="brodie-fade-in space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Signed up" value={signedUp.toLocaleString()}
          sub={`in ${withSignups} of ${open} open ${open === 1 ? "market" : "markets"}`} />
        <Tile label="Deposits" value={deposits.length ? deposits.map(([c, n]) => money(n, c)).join(" · ") : "$0.00"}
          sub="before processing fees and tax" />
        <Tile label="Started, not paid" value={started.toLocaleString()}
          sub="began signing up and didn't put down the deposit" />
        <Tile label="New to Brodie" value={pct(newToBrodie, signedUp)}
          sub={`${newToBrodie} of ${signedUp} had never played`} />
      </div>

      {markets.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No waitlists set up yet.
        </div>
      ) : (
        <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr className="text-xs font-bold text-glass-text-tertiary">
                  <Th align="left">Market</Th>
                  <Th align="left">Launch</Th>
                  <Th align="left">Status</Th>
                  <Th>Signed up</Th>
                  <Th>Started, not paid</Th>
                  <Th>New to Brodie</Th>
                  <Th>Deposits</Th>
                  <Th>Latest sign-up</Th>
                </tr>
              </thead>
              <tbody>
                {markets.map((r) => {
                  const quiet = r.signed_up === 0 && r.started === 0;
                  const st = STATUS[r.status] ?? { label: r.status, style: STATUS.draft.style };
                  return (
                    <tr key={r.market} style={{ borderTop: "1px solid var(--glass-border)" }}>
                      <td className="px-4 py-2.5 font-semibold"
                        style={{ color: quiet ? "var(--glass-text-secondary)" : "var(--glass-text)" }}>
                        {r.market}
                      </td>
                      <td className="px-4 py-2.5 text-glass-text-secondary whitespace-nowrap">{r.launch ?? "—"}</td>
                      <td className="px-4 py-2.5"><span className={CHIP} style={st.style}>{st.label}</span></td>
                      <td className="px-4 py-2.5 text-right tabular font-semibold"
                        style={{ color: r.signed_up ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                        {r.signed_up}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular"
                        style={{ color: r.started ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                        {r.started}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">
                        {r.signed_up ? (
                          <>
                            <div style={{ color: "var(--glass-text)" }}>{pct(r.new_to_brodie, r.signed_up)}</div>
                            <div className="text-[11px] text-glass-text-tertiary">{r.new_to_brodie} of {r.signed_up}</div>
                          </>
                        ) : <span className="text-glass-text-tertiary">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
                        style={{ color: r.deposits ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                        {r.deposits && r.currency ? money(r.deposits, r.currency) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular whitespace-nowrap text-glass-text-secondary">
                        {shortDate(r.latest_signup)}
                      </td>
                    </tr>
                  );
                })}
                {markets.length > 1 && (
                  <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                    <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }} colSpan={3}>All markets</td>
                    <td className="px-4 py-3 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>{signedUp}</td>
                    <td className="px-4 py-3 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>{started}</td>
                    <td className="px-4 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                      {pct(newToBrodie, signedUp)}
                    </td>
                    <td className="px-4 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                      {deposits.length ? deposits.map(([c, n]) => money(n, c)).join(" · ") : "—"}
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every waitlist set up in the ops platform for a market Brodie hasn&apos;t opened yet. Signed up is people who
        put down the deposit; started, not paid is people who began and didn&apos;t finish; each person counts once
        per market. Launch is the season the waitlist is for. New to Brodie means no roster spot and no completed
        season registration before they signed up. Deposits are the price after any discount, before processing fees
        and sales tax.
      </p>
    </main>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`}>{children}</th>;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
