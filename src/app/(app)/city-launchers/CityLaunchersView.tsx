import { csvParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { requireRole } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import { CITY_LAUNCHERS, CITY_LAUNCHER_ROLES, type CityLauncher } from "@/lib/city-launchers";

// City launchers: for each launcher's market, every completed registration of
// the season and what it cost Brodie. A registration can cost a discount (the
// launcher's own code, the referral program's $20, another code, a lower
// price, an admin adjustment), a referral earning to the captain whose link
// the player came through, and the launcher's credit when it used their code.
// The two don't exclude each other: a player who joins through their
// captain's team link and types in the launcher's code at checkout swaps the
// referral discount for the code, and the captain is still paid. The Promo
// Tracker owns the ops-DB connection, so the rows come from its feed.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Code = { code: string; name: string; amount: number; overrides_price: boolean; is_referral: boolean };
type Registration = {
  location: string;
  player: string;
  role: "captain" | "player" | "free_agent";
  team: string | null;
  registered: string;
  payment_status: string | null;
  currency: string;
  price: number;
  codes: Code[];
  adjustment: number;
  adjustment_note: string | null;
  referral_to: string | null;
  referral_earning: number;
  is_new: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  came_from: string | null;
  landed: boolean;
};

async function loadRegistrations(season: string, location: string): Promise<Registration[] | null> {
  try {
    const url = new URL("/api/registration-costs", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("location", location);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { registrations?: Registration[] };
    return Array.isArray(k.registrations) ? k.registrations : null;
  } catch {
    return null;
  }
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ROLE: Record<Registration["role"], string> = { captain: "Captain", player: "Joined a team", free_agent: "Free agent" };
const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const GREY: React.CSSProperties = { color: "var(--glass-text-secondary)", background: "var(--fill-3)" };
const AMBER: React.CSSProperties = { color: "var(--amber-ink)", background: "var(--amber-tint)" };
const RED: React.CSSProperties = { color: "var(--red)", background: "var(--red-tint)" };

// Where the player came from, from the campaign tags on the link they
// registered through, else the site that sent them, else the bare fact that
// they landed on the site.
function cameFrom(r: Registration): string {
  const src = (r.utm_source ?? "").toLowerCase();
  const med = (r.utm_medium ?? "").toLowerCase();
  const content = (r.utm_content ?? "").toLowerCase();
  const nice = (s: string) => (s === "meta" || s === "facebook" || s === "fb" ? "Meta" : s === "ig" ? "Instagram"
    : s ? s[0].toUpperCase() + s.slice(1) : "");
  if (med.includes("paid")) return `Paid ${nice(src)} ad`.replace(/\s+/g, " ");
  if (src === "instagram" || src === "ig") return content.includes("bio") ? "Instagram link in bio" : "Instagram";
  if (src) return med ? `${nice(src)} (${med.replace(/_/g, " ")})` : nice(src);
  if (r.came_from) return r.came_from.replace(/^(www|l|lm|m)\./, "");
  if (r.landed) return "Brodie website, no campaign tag";
  return "No source recorded";
}

type Costed = Registration & {
  launcherCode: string | null;
  source: string;
  discount: number;
  credit: number;
  cost: number;
};

// Every registration with what it cost, for one launcher.
function costRegistrations(rows: Registration[], launcher: CityLauncher): Costed[] {
  const mine = new Set(launcher.codes.map((c) => c.toUpperCase()));
  const first = launcher.name.split(" ")[0];
  // A code that sets a lower price takes nothing off the invoice, so it is
  // measured against the list price: the price most registrations paid.
  const listPrice = new Map<string, number>();
  const tally = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.codes.some((c) => c.overrides_price)) continue;
    const m = tally.get(r.currency) ?? new Map<number, number>();
    m.set(r.price, (m.get(r.price) ?? 0) + 1);
    tally.set(r.currency, m);
  }
  for (const [cur, m] of tally) listPrice.set(cur, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  return rows.map((r) => {
    const launcherCode = r.codes.find((c) => mine.has(c.code.toUpperCase()))?.code ?? null;
    const override = r.codes.find((c) => c.overrides_price);
    const overrideOff = override ? Math.max(0, (listPrice.get(r.currency) ?? r.price) - r.price) : 0;
    const discount = Math.round((r.codes.reduce((s, c) => s + c.amount, 0) + overrideOff + r.adjustment) * 100) / 100;
    const referral = r.codes.find((c) => c.is_referral);
    const other = r.codes.filter((c) => !c.is_referral && !mine.has(c.code.toUpperCase()));
    let source = launcherCode ? `${first}'s code (${launcherCode})`
      : referral ? `Referral program (${referral.code})`
      : other.length ? other.map((c) => (c.overrides_price ? `${c.code} price` : `Code ${c.code}`)).join(" + ")
      : r.adjustment ? "Admin adjustment" : "None";
    if (r.adjustment && source !== "Admin adjustment") source += ` + ${r.adjustment_note ?? "admin adjustment"}`;
    const credit = launcherCode ? launcher.creditPerUse : 0;
    return { ...r, launcherCode, source, discount, credit, cost: Math.round((discount + r.referral_earning + credit) * 100) / 100 };
  });
}

type CityLaunchersParams = { season?: string; location?: string };

export default async function CityLaunchersView({ searchParams }: { searchParams: Promise<CityLaunchersParams> }) {
  await requireRole([...CITY_LAUNCHER_ROLES]);
  const { season: seasonParam, location: locationParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam);

  // A launcher is opening a market, so the season that matters is the one
  // being registered for.
  const { promoSeasons, selectedSeason } = await resolveScope(
    { season: selectedSeasons[0] },
    { defaultSeason: "registration" },
  );
  const launcherLocations = [...new Set(CITY_LAUNCHERS.map((l) => l.location))];
  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: launcherLocations,
  };
  const shown = CITY_LAUNCHERS.filter((l) => !selectedLocations.length || selectedLocations.includes(l.location));
  const loaded = await Promise.all(shown.map((l) => loadRegistrations(selectedSeason, l.location)));

  return (
    <main className="brodie-fade-in space-y-8">
      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{ seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason], locations: selectedLocations }}
      />

      {shown.map((launcher, i) => (
        <LauncherSection key={launcher.name} launcher={launcher} season={selectedSeason} rows={loaded[i]} />
      ))}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every completed registration at the launcher&apos;s location this season, a payment plan with a failed
        instalment included. Discount to player is what came off the price before tax and fees: the codes on the
        registration, a lower price set by a code (against the price most people paid), and any admin adjustment.
        The referral program&apos;s $20 can&apos;t be combined with another code, so a player who types in a code at
        checkout gives it up, but the captain whose team link they came through is still paid the referral. The
        launcher is credited a flat amount for each registration that used their code; no payout for it is recorded
        in the admin. Where they came from is read from the link they registered through.
      </p>
    </main>
  );
}

function LauncherSection({ launcher, season, rows }: { launcher: CityLauncher; season: string; rows: Registration[] | null }) {
  const first = launcher.name.split(" ")[0];
  const header = (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
        {launcher.location} · {launcher.name}
      </h2>
      <p className="text-sm text-glass-text-secondary">
        Code {launcher.codes.join(", ")} · {money(launcher.creditPerUse)} credit for each registration that uses it
      </p>
    </div>
  );
  if (!rows) {
    return (
      <section className="space-y-3">
        {header}
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Registration feed unavailable: the Promo Tracker didn&apos;t answer for {launcher.location} in {season}.
        </div>
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        {header}
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No completed registrations at {launcher.location} in {season}.
        </div>
      </section>
    );
  }

  const costed = costRegistrations(rows, launcher);
  const currency = [...new Set(costed.map((r) => r.currency))].join(" / ");
  const sum = (f: (r: Costed) => number) => costed.reduce((s, r) => s + f(r), 0);
  const used = costed.filter((r) => r.launcherCode);
  const discounts = sum((r) => r.discount);
  const referrals = sum((r) => r.referral_earning);
  const credit = sum((r) => r.credit);
  const total = sum((r) => r.cost);
  const captainsPaid = new Set(costed.filter((r) => r.referral_earning > 0).map((r) => r.referral_to)).size;
  const byRole = (role: Registration["role"]) => costed.filter((r) => r.role === role).length;

  // One row per kind of registration: who it was, how the discount came, and
  // whether a captain was paid for them.
  type Group = { key: string; who: string; source: string; rows: Costed[] };
  const groups = new Map<string, Group>();
  for (const r of costed) {
    const paid = r.referral_earning > 0;
    const key = `${r.role}|${r.source}|${paid}`;
    const g = groups.get(key) ?? { key, who: ROLE[r.role], source: r.source, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const groupRows = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || b.rows[0].cost - a.rows[0].cost);
  const paidTwice = costed.filter((r) => r.launcherCode && r.referral_earning > 0);
  const noDiscount = costed.filter((r) => r.discount === 0 && r.codes.length === 0);

  return (
    <section className="space-y-6">
      {header}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Tile label="Registrations" value={costed.length.toLocaleString()}
          sub={`${byRole("captain")} captains · ${byRole("player")} joined a team · ${byRole("free_agent")} free agents`} />
        <Tile label={`Used ${first}'s code`} value={used.length.toLocaleString()}
          sub={`${first}'s credit ${money(credit)} at ${money(launcher.creditPerUse)} each`} />
        <Tile label="Discounts to players" value={money(discounts)}
          sub={`${costed.filter((r) => r.discount > 0).length} of ${costed.length} registrations got one`} />
        <Tile label="Referral earnings" value={money(referrals)}
          sub={`to ${captainsPaid} ${captainsPaid === 1 ? "captain" : "captains"} for ${costed.filter((r) => r.referral_earning > 0).length} players`} />
        <Tile label="Total cost" value={money(total)}
          sub={`${money(total / costed.length)} a registration on average · ${currency}`} />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>What each registration costs</h3>
        <Table minWidth={860}>
          <thead>
            <tr className="text-xs font-bold text-glass-text-tertiary">
              <Th align="left" width="16%">Who</Th>
              <Th align="left" width="30%">Discount</Th>
              <Th width="9%">How many</Th>
              <Th width="12%">Discount each</Th>
              <Th align="left" width="21%">Paid to others</Th>
              <Th width="12%">Cost each</Th>
            </tr>
          </thead>
          <tbody>
            {groupRows.map((g) => {
              const n = g.rows.length;
              const each = (f: (r: Costed) => number) => g.rows.reduce((s, r) => s + f(r), 0) / n;
              const ref = each((r) => r.referral_earning), cr = each((r) => r.credit);
              const paidTo = [
                ref ? `${money(ref)} to their captain` : null,
                cr ? `${money(cr)} to ${first}` : null,
              ].filter(Boolean).join(" + ");
              const twice = ref > 0 && cr > 0;
              return (
                <tr key={g.key} style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{g.who}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{g.source}</td>
                  <Num>{n}</Num>
                  <Num>{money(each((r) => r.discount))}</Num>
                  <td className="px-4 py-2.5 text-glass-text-secondary">{paidTo || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular font-semibold whitespace-nowrap">
                    {twice ? <span className={CHIP} style={RED}>{money(each((r) => r.cost))}</span>
                      : <span style={{ color: "var(--glass-text)" }}>{money(each((r) => r.cost))}</span>}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
              <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }} colSpan={2}>All registrations</td>
              <Num bold>{costed.length}</Num>
              <Num bold>{money(discounts)}</Num>
              <td className="px-4 py-3 text-glass-text-secondary">
                {money(referrals)} to captains + {money(credit)} to {first}
              </td>
              <Num bold>{money(total)}</Num>
            </tr>
          </tbody>
        </Table>
      </div>

      {paidTwice.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
            Used {first}&apos;s code and their captain was paid the referral
            <span className="ml-2 text-xs font-normal text-glass-text-tertiary">{paidTwice.length} players</span>
          </h3>
          <p className="text-sm text-glass-text-secondary max-w-[90ch]">
            They joined through their captain&apos;s team link, which pays the captain {money(paidTwice[0].referral_earning)},
            then typed in {first}&apos;s code at checkout, which replaces the referral discount. Each one costs the code,
            the referral and {first}&apos;s credit.
          </p>
          <Table minWidth={640}>
            <thead>
              <tr className="text-xs font-bold text-glass-text-tertiary">
                <Th align="left" width="30%">Player</Th>
                <Th align="left" width="28%">Team</Th>
                <Th align="left" width="26%">Captain paid</Th>
                <Th width="16%">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {paidTwice.map((r, i) => (
                <tr key={`${r.player}-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>{r.player}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{r.team ?? "—"}</td>
                  <td className="px-4 py-2.5 text-glass-text-secondary">{r.referral_to ?? "—"}</td>
                  <Num>{money(r.cost)}</Num>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {noDiscount.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
            No discount
            <span className="ml-2 text-xs font-normal text-glass-text-tertiary">{noDiscount.length} registrations</span>
          </h3>
          <Table minWidth={720}>
            <thead>
              <tr className="text-xs font-bold text-glass-text-tertiary">
                <Th align="left" width="24%">Player</Th>
                <Th align="left" width="15%">Registration</Th>
                <Th align="left" width="20%">Team</Th>
                <Th align="left" width="13%">New to Brodie</Th>
                <Th align="left" width="28%">Where they came from</Th>
              </tr>
            </thead>
            <tbody>
              {noDiscount.map((r, i) => (
                <tr key={`${r.player}-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>{r.player}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{ROLE[r.role]}</td>
                  <td className="px-4 py-2.5" style={{ color: r.team ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                    {r.team ?? (r.role === "free_agent" ? "Not placed yet" : "—")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={CHIP} style={r.is_new ? AMBER : GREY}>{r.is_new ? "New" : "Returning"}</span>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>
                    {cameFrom(r)}
                    {r.utm_campaign && <div className="text-[11px] text-glass-text-tertiary">{r.utm_campaign}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
          Every registration
          <span className="ml-2 text-xs font-normal text-glass-text-tertiary">{costed.length}</span>
        </h3>
        <Table minWidth={1240}>
          <thead>
            <tr className="text-xs font-bold text-glass-text-tertiary">
              <Th align="left" width="13%">Player</Th>
              <Th align="left" width="9%">Registration</Th>
              <Th align="left" width="12%">Team</Th>
              <Th align="left" width="8%">Registered</Th>
              <Th align="left" width="17%">Discount</Th>
              <Th width="8%">Discount to player</Th>
              <Th align="left" width="11%">Referral paid to</Th>
              <Th width="7%">Referral</Th>
              <Th width="7%">{first}&apos;s credit</Th>
              <Th width="8%">Total cost</Th>
            </tr>
          </thead>
          <tbody>
            {costed.map((r, i) => (
              <tr key={`${r.player}-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>
                  {r.player}
                  {!r.is_new && <span className={`${CHIP} ml-1.5`} style={GREY}>Returning</span>}
                </td>
                <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{ROLE[r.role]}</td>
                <td className="px-4 py-2.5" style={{ color: r.team ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                  {r.team ?? "—"}
                </td>
                <td className="px-4 py-2.5 tabular text-glass-text-secondary whitespace-nowrap">{shortDate(r.registered)}</td>
                <td className="px-4 py-2.5" style={{ color: r.source === "None" ? "var(--glass-text-tertiary)" : "var(--glass-text)" }}>
                  {r.source}
                </td>
                <Num muted={!r.discount}>{r.discount ? money(r.discount) : "—"}</Num>
                <td className="px-4 py-2.5 text-glass-text-secondary">{r.referral_to ?? "—"}</td>
                <Num muted={!r.referral_earning}>{r.referral_earning ? money(r.referral_earning) : "—"}</Num>
                <Num muted={!r.credit}>{r.credit ? money(r.credit) : "—"}</Num>
                <td className="px-4 py-2.5 text-right tabular font-semibold" style={{ color: r.cost ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                  {r.cost ? money(r.cost) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </section>
  );
}

// "Oct 13" for "2026-10-13".
function shortDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function Table({ children, minWidth }: { children: React.ReactNode; minWidth: number }) {
  return (
    <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth, tableLayout: "fixed" }}>
          {children}
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = "right", width }: { children: React.ReactNode; align?: "left" | "right"; width?: string }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`} style={width ? { width } : undefined}>
      {children}
    </th>
  );
}

function Num({ children, muted = false, bold = false }: { children: React.ReactNode; muted?: boolean; bold?: boolean }) {
  return (
    <td className={`px-4 ${bold ? "py-3 font-bold" : "py-2.5"} text-right tabular whitespace-nowrap`}
      style={{ color: muted ? "var(--glass-text-tertiary)" : "var(--glass-text)" }}>
      {children}
    </td>
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
