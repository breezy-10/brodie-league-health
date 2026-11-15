import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { promoFetch } from "@/lib/promo-feed";
import { normEmail, normName } from "@/lib/directory";

// The districts app computes the bonus (GET /api/lm-bonus, LM Comp Model V5
// with its own data, floors, credit and manager gate) and this page shows it,
// so the two can't disagree. The feed carries no base salary and no revenue
// or collected money; this page adds none.
const DISTRICTS_URL = (process.env.DISTRICTS_URL ?? "https://brodie-districts.vercel.app").replace(/\/$/, "");

// Who sees everyone's bonus; a league manager sees only their own (Sohaib,
// Nov 15).
const SEE_ALL_ROLES = ["dm", "operations_manager", "super_admin"];

type Night = {
  night: string | null;
  teams: number;
  fully_paid: number;
  still_paying: number;
  back: number[] | null;
  value_cents: number;
  pay_cents: number;
  works: string | null;
  credited_to: string | null;
  is_worked: boolean;
  is_credited: boolean;
  why: string | null;
};
type Location = {
  location_id: string;
  location: string;
  currency: "CAD" | "USD";
  bonus_cents: number;
  back: number[] | null;
  why: string | null;
  nights: Night[];
};
type Manager = {
  name: string;
  email: string | null;
  currency: "CAD" | "USD";
  bonus_cents: number;
  unearned_cents: number;
  teams_credited: number;
  teams_worked: number;
  min_teams: number;
  qualifies: boolean;
  locations: Location[];
};
type Feed = { model: "v5"; season: { key: string; label: string }; rates_cents: number[]; managers: Manager[] };

async function loadFeed(): Promise<Feed | null> {
  const token = process.env.LM_BONUS_FEED_TOKEN;
  if (!token) return null;
  try {
    const res = await promoFetch(`${DISTRICTS_URL}/api/lm-bonus`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const f = (await res.json()) as Feed;
    return Array.isArray(f.managers) ? f : null;
  } catch {
    return null;
  }
}

const money = (cents: number, ccy: string) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} ${ccy}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// The six recency groups the feed counts, read as the three the comp model is
// set in: played here in the past year (last 1-4 seasons), 5+ seasons back,
// and new to the location.
const pastYear = (b: number[]) => b[0] + b[1] + b[2] + b[3];

// The amounts a player is worth this season, as the comp model shows them: one
// amount for the past year when its four seasons share it, else each.
function rateLines(r: number[]): { label: string; cents: number }[] {
  const past = r.slice(0, 4);
  const lines = past.every((c) => c === past[0])
    ? [{ label: "Played here in the past year", cents: past[0] }]
    : past.map((c, i) => ({ label: i === 0 ? "Played here last season" : `Played here ${i + 1} seasons back`, cents: c }));
  return [...lines, { label: "Played here 5+ seasons back", cents: r[4] }, { label: "New to the location", cents: r[5] }];
}

export default async function LmBonusView() {
  const { profile } = await requireUser();
  const seeAll = SEE_ALL_ROLES.includes(profile?.role ?? "");
  const feed = await loadFeed();

  if (!feed) {
    return (
      <main className="brodie-fade-in">
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          League Health couldn&apos;t load the bonus from the districts app, so none is shown.
        </div>
      </main>
    );
  }

  // A league manager is matched by email, else by the name on their roster
  // row or profile (placeholders and a few managers have no email on file).
  let managers = feed.managers;
  if (!seeAll) {
    const email = normEmail(profile?.email);
    const { data: roster } = await createAdminClient()
      .from("league_managers").select("full_name").eq("email", email).maybeSingle();
    const names = new Set([roster?.full_name, profile?.full_name].map(normName).filter(Boolean));
    const mine = feed.managers.find((m) => normEmail(m.email) === email)
      ?? feed.managers.find((m) => names.has(normName(m.name)));
    managers = mine ? [mine] : [];
  }

  const rates = rateLines(feed.rates_cents);
  return (
    <main className="brodie-fade-in space-y-6">
      <section className="rounded-2xl bg-glass-surface p-5 shadow-card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{feed.season.label}</h2>
          <span className="text-xs text-glass-text-tertiary">LM Comp Model V5</span>
        </div>
        <p className="text-sm text-glass-text-secondary max-w-[80ch]">
          Every fully paid player earns you an amount set by when they last played at that location. A day pays once
          its location reaches its team minimum, and nothing pays until you&apos;re credited enough teams across all
          your locations.
        </p>
        <div className="flex flex-wrap gap-2">
          {rates.map((r) => (
            <span key={r.label} className="inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-xs" style={{ background: "var(--fill-3)" }}>
              <span className="text-glass-text-secondary">{r.label}</span>
              <span className="font-bold tabular" style={{ color: "var(--glass-text)" }}>${(r.cents / 100).toFixed(r.cents % 100 ? 2 : 0)}</span>
            </span>
          ))}
        </div>
      </section>

      {managers.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          {seeAll
            ? `No league manager has a bonus in ${feed.season.label} yet.`
            : `There's no bonus under your name for ${feed.season.label}. If you run a location this season, ask your district manager to check you're its league manager in the districts app.`}
        </div>
      ) : seeAll ? (
        <>
          <ManagersTable managers={managers} />
          {managers.map((m) => (
            <details key={m.name} className="group rounded-2xl bg-glass-surface shadow-card">
              <summary className="cursor-pointer list-none px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{m.name}</span>
                <span className="flex items-center gap-3 text-sm">
                  <GateChip m={m} />
                  <span className="font-bold tabular" style={{ color: "var(--glass-text)" }}>{money(m.bonus_cents, m.currency)}</span>
                </span>
              </summary>
              <div className="px-5 pb-5"><ManagerDetail m={m} rates={feed.rates_cents} /></div>
            </details>
          ))}
        </>
      ) : (
        <ManagerDetail m={managers[0]} rates={feed.rates_cents} showTiles />
      )}
    </main>
  );
}

// Teams credited against the manager minimum, as a chip.
function GateChip({ m }: { m: Manager }) {
  const short = m.min_teams - m.teams_credited;
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
      style={m.qualifies
        ? { color: "var(--green-ink)", background: "var(--green-tint)" }
        : { color: "var(--red-ink)", background: "var(--red-tint)" }}>
      {m.qualifies ? `${m.teams_credited} of ${m.min_teams} teams` : `${short} ${short === 1 ? "team" : "teams"} short`}
    </span>
  );
}

// Everyone at a glance, for those who see all.
function ManagersTable({ managers }: { managers: Manager[] }) {
  const totals = new Map<string, number>();
  for (const m of managers) totals.set(m.currency, (totals.get(m.currency) ?? 0) + m.bonus_cents);
  const players = (m: Manager) => m.locations.reduce((n, l) => n + l.nights.filter((s) => s.is_credited).reduce((k, s) => k + s.fully_paid, 0), 0);
  return (
    <div className="rounded-2xl bg-glass-surface shadow-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-bold text-glass-text-tertiary">
            <th className="px-5 py-2.5 text-left">League manager</th>
            <th className="px-5 py-2.5 text-left">Locations</th>
            <th className="px-5 py-2.5 text-right">Teams credited</th>
            <th className="px-5 py-2.5 text-right">Fully paid players</th>
            <th className="px-5 py-2.5 text-right">Bonus</th>
          </tr>
        </thead>
        <tbody>
          {managers.map((m) => (
            <tr key={m.name} style={{ borderTop: "1px solid var(--glass-border)" }}>
              <td className="px-5 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{m.name}</td>
              <td className="px-5 py-2.5 text-glass-text-secondary">{m.locations.map((l) => l.location).join(", ")}</td>
              <td className="px-5 py-2.5 text-right tabular whitespace-nowrap">
                <div style={{ color: "var(--glass-text)" }}>{m.teams_credited} <span className="text-glass-text-tertiary">of {m.min_teams}</span></div>
                {!m.qualifies && <div className="text-[11px]" style={{ color: "var(--red)" }}>{m.min_teams - m.teams_credited} short</div>}
              </td>
              <td className="px-5 py-2.5 text-right tabular" style={{ color: "var(--glass-text)" }}>{players(m).toLocaleString()}</td>
              <td className="px-5 py-2.5 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{money(m.bonus_cents, m.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
            <td className="px-5 py-3 font-bold" style={{ color: "var(--glass-text)" }} colSpan={4}>Total</td>
            <td className="px-5 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
              {[...totals.entries()].map(([c, v]) => <div key={c}>{money(v, c)}</div>)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// One manager's bonus: the headline figures, then each location day by day.
function ManagerDetail({ m, rates, showTiles = false }: { m: Manager; rates: number[]; showTiles?: boolean }) {
  const credited = m.locations.flatMap((l) => l.nights.filter((s) => s.is_credited));
  const fullyPaid = credited.reduce((n, s) => n + s.fully_paid, 0);
  const stillPaying = credited.reduce((n, s) => n + s.still_paying, 0);
  const short = m.min_teams - m.teams_credited;
  return (
    <div className="space-y-4">
      {showTiles && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Tile label="Your bonus" value={money(m.bonus_cents, m.currency)}
            sub={m.unearned_cents > 0 ? `${money(m.unearned_cents, m.currency)} more is waiting on the minimums below` : "everything you're credited pays"} />
          <Tile label="Teams credited" value={`${m.teams_credited} of ${m.min_teams}`}
            sub={m.qualifies ? "you've reached your team minimum" : `${plural(short, "team")} short: nothing pays until you reach ${m.min_teams}`}
            color={m.qualifies ? undefined : "var(--red)"} />
          <Tile label="Fully paid players" value={fullyPaid.toLocaleString()}
            sub={stillPaying ? `${plural(stillPaying, "more player")} still paying; they count once paid in full` : "nobody still paying"} />
        </div>
      )}
      {m.locations.map((l) => (
        <div key={l.location_id} className="rounded-xl overflow-x-auto" style={{ border: "1px solid var(--glass-border)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
            <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{l.location}</span>
            <span className="text-sm font-bold tabular" style={{ color: "var(--glass-text)" }}>{money(l.bonus_cents, l.currency)}</span>
          </div>
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-xs font-bold text-glass-text-tertiary">
                <th className="px-4 py-2 text-left">Day</th>
                <th className="px-4 py-2 text-right">Teams</th>
                <th className="px-4 py-2 text-right">Fully paid players</th>
                <th className="px-4 py-2 text-right">Still paying</th>
                <th className="px-4 py-2 text-right">Worth</th>
                <th className="px-4 py-2 text-right">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {l.nights.map((s, i) => (
                <tr key={s.night ?? i} style={{ borderTop: "1px solid var(--glass-border-light)" }}>
                  <td className="px-4 py-2 align-top">
                    <div style={{ color: "var(--glass-text)" }}>{s.night ?? "All days"}</div>
                    {s.is_credited && !s.is_worked && s.works && (
                      <div className="text-[11px] text-glass-text-tertiary">worked by {s.works}; you signed these teams up</div>
                    )}
                    {s.is_worked && !s.is_credited && (
                      <div className="text-[11px] text-glass-text-tertiary">credited to {s.credited_to ?? "nobody"}, who signed these teams up</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular align-top" style={{ color: "var(--glass-text)" }}>{s.teams}</td>
                  <td className="px-4 py-2 text-right tabular align-top">
                    <div style={{ color: "var(--glass-text)" }}>{s.fully_paid}</div>
                    {s.back && (
                      <div className="text-[11px] text-glass-text-tertiary whitespace-nowrap">
                        {pastYear(s.back)} past year · {s.back[4]} 5+ back · {s.back[5]} new
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular align-top text-glass-text-secondary">{s.still_paying}</td>
                  <td className="px-4 py-2 text-right tabular align-top text-glass-text-secondary whitespace-nowrap"
                    title={s.back ? workings(s.back, rates) : "this location's player history isn't recorded by day, so its value is shared out by players"}>
                    {s.is_credited ? money(s.value_cents, l.currency) : "–"}
                  </td>
                  <td className="px-4 py-2 text-right tabular align-top whitespace-nowrap">
                    {!s.is_credited ? (
                      <span className="text-glass-text-tertiary">–</span>
                    ) : s.pay_cents > 0 ? (
                      <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{money(s.pay_cents, l.currency)}</span>
                    ) : (
                      <>
                        <div style={{ color: "var(--glass-text)" }}>{money(0, l.currency)}</div>
                        {s.why && <div className="text-[11px]" style={{ color: "var(--red)" }}>{s.why}</div>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// "13 × $5 + 2 × $2 + 7 × $1", the sum behind a day's worth.
function workings(back: number[], rates: number[]): string {
  return back
    .map((n, i) => (n ? `${n} × $${(rates[i] / 100).toFixed(rates[i] % 100 ? 2 : 0)}` : null))
    .filter(Boolean)
    .join(" + ") || "no fully paid players yet";
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: color ?? "var(--glass-text)" }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
