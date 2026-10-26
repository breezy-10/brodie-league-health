import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import WaitlistTable, { money, pct, type WaitlistPerson, type WaitlistRow } from "./WaitlistTable";

// Expansion waitlists: every market ops has opened a waitlist for, how many
// people put down a deposit to be first in, how many started and didn't pay,
// and how many are new to Brodie. Markets aren't locations yet, so there's no
// season or location filter. The Promo Tracker owns the ops-DB connection.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

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

// Each market's people by name, for the rows that open.
async function loadWaitlistPeople(): Promise<WaitlistPerson[] | null> {
  try {
    const url = new URL("/api/waitlist", PROMO_APP_URL);
    url.searchParams.set("view", "people");
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { people?: WaitlistPerson[] };
    return Array.isArray(k.people) ? k.people : null;
  } catch {
    return null;
  }
}

export default async function WaitlistView() {
  await requireUser();
  return <WaitlistBody />;
}

// The page itself, apart from the sign-in check.
export async function WaitlistBody() {
  const [rows, peopleList] = await Promise.all([loadWaitlist(), loadWaitlistPeople()]);

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
        <WaitlistTable markets={markets}
          people={Object.fromEntries(markets.map((r) => [r.market, (peopleList ?? []).filter((p) => p.market === r.market)]))}
          totals={{ signedUp, started, newToBrodie, deposits }} />
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

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
