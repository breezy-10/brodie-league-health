import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import { loadLocationRequests, type CityRequest, type LocationRequests } from "@/lib/slack/location-requests";

// Requested cities: every submission of the website's request-a-city form,
// which lands in the #location-requests Slack channel, grouped by city, with
// the people offering to launch one called out and the cities that already
// have a waitlist marked. Contact details stay in Slack.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

// The open waitlist markets and how many signed up for each, so a requested
// city that already has one says so and shows its sign-ups.
type WaitlistMarket = { market: string; signed_up: number };
async function loadWaitlistMarkets(): Promise<WaitlistMarket[]> {
  try {
    const res = await promoFetch(new URL("/api/waitlist", PROMO_APP_URL).toString(), { cache: "no-store" });
    if (!res.ok) return [];
    const k = (await res.json()) as { markets?: { market: string; status: string; signed_up: number }[] };
    return (k.markets ?? []).filter((m) => m.status === "open").map((m) => ({ market: m.market, signed_up: m.signed_up ?? 0 }));
  } catch {
    return [];
  }
}

// Waitlist markets named for a region rather than a city: the requested
// cities inside them count toward that waitlist.
const MARKET_CITIES: Record<string, string[]> = {
  "bay area": ["san francisco", "oakland", "san jose", "walnut creek", "berkeley", "palo alto"],
  "dmv": ["washington", "alexandria", "arlington", "tysons", "bethesda", "silver spring"],
};

// One city however it was typed: "Miami/Broward County", "miami" and
// "Miami, FL" are all Miami; the country keeps London, England apart from
// London, Ontario.
// Spellings of one place: "Tampa Bay" is Tampa, "Saint Louis" is St. Louis,
// "Chatham" is Chatham-Kent.
const CITY_ALIASES: Record<string, string> = {
  "tampa bay": "tampa", "saint louis": "st. louis", "st louis": "st. louis", "st.louis": "st. louis",
  "chatham": "chatham-kent", "chatham kent": "chatham-kent", "fort worth or dallas": "dallas",
};
const cityName = (r: CityRequest) => {
  const base = r.city.split(/[\/,(]/)[0].trim().toLowerCase().replace(/\s+/g, " ");
  return CITY_ALIASES[base] ?? base;
};
const cityKey = (r: CityRequest) => `${cityName(r)}|${(r.country ?? "").toLowerCase()}`;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-.])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// Toronto date and time of a request.
function when(iso: string): { day: string; date: string } {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Toronto" }).format(d),
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(d),
  };
}

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const LAUNCHER_CHIP: React.CSSProperties = { color: "var(--amber-ink)", background: "var(--amber-tint)" };
const WAITLIST_CHIP: React.CSSProperties = { color: "var(--green)", background: "var(--green-tint)" };

export default async function RequestedCitiesView() {
  await requireUser();
  const [feed, waitlist] = await Promise.all([loadLocationRequests(), loadWaitlistMarkets()]);
  return <RequestedCitiesBody feed={feed} waitlist={waitlist} />;
}

// The page itself, from the requests and the open waitlist markets.
export function RequestedCitiesBody({ feed, waitlist }: { feed: LocationRequests; waitlist: WaitlistMarket[] }) {

  if (!feed.ok) {
    return (
      <main className="brodie-fade-in space-y-6">
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          Requested cities come from the #location-requests Slack channel, and League Health couldn&apos;t read it.{" "}
          {feed.reason}
        </div>
      </main>
    );
  }

  const requests = feed.requests;
  // City (lowercase) -> its waitlist market's sign-ups.
  const waitlistFor = new Map<string, number>();
  for (const m of waitlist) {
    const key = m.market.trim().toLowerCase();
    waitlistFor.set(key, m.signed_up);
    for (const c of MARKET_CITIES[key] ?? []) waitlistFor.set(c, m.signed_up);
  }

  // Each city once, with the people who asked for it counted once each.
  type City = {
    key: string; names: Map<string, number>; region: string | null; country: string | null;
    people: Set<string>; launchers: Set<string>; latest: string; waitlist: boolean;
  };
  const cities = new Map<string, City>();
  for (const r of requests) {
    const k = cityKey(r);
    const c = cities.get(k) ?? {
      key: k, names: new Map(), region: r.region, country: r.country,
      people: new Set(), launchers: new Set(), latest: r.at, waitlist: false,
    };
    const shown = titleCase(cityName(r));
    c.names.set(shown, (c.names.get(shown) ?? 0) + 1);
    c.people.add(r.person);
    if (r.launcher) c.launchers.add(r.person);
    if (r.at > c.latest) c.latest = r.at;
    if (!c.region && r.region) c.region = r.region;
    cities.set(k, c);
  }
  const rows = [...cities.values()].map((c) => {
    const name = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const northAmerica = c.country === "United States" || c.country === "Canada";
    const signups = northAmerica ? waitlistFor.get(name.toLowerCase()) : undefined;
    return { ...c, name, waitlist: signups !== undefined, signups: signups ?? null };
  }).sort((a, b) => b.people.size - a.people.size || b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name));

  const people = new Set(requests.map((r) => r.person)).size;
  const launchers = new Set(requests.filter((r) => r.launcher).map((r) => r.person)).size;
  const countries = new Set(requests.map((r) => r.country).filter(Boolean)).size;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const lastWeek = requests.filter((r) => r.at >= weekAgo).length;
  const recent = requests.slice(0, 50);

  return (
    <main className="brodie-fade-in space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Requests" value={requests.length.toLocaleString()}
          sub={`from ${people.toLocaleString()} ${people === 1 ? "person" : "people"}`} />
        <Tile label="Cities" value={rows.length.toLocaleString()}
          sub={`in ${countries} ${countries === 1 ? "country" : "countries"}`} />
        <Tile label="Last 7 days" value={lastWeek.toLocaleString()} sub="new requests" />
        <Tile label="City launchers" value={launchers.toLocaleString()} sub="offered to launch their city" />
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No city requests yet.
          {/* Messages read but none parsed means the form's format changed. */}
          {(feed.scanned ?? 0) > 0 && (
            <span className="block not-italic mt-1 text-[11px]">
              Read {feed.scanned} Slack messages and found no form submissions in them.{feed.shape ? ` First bot message: ${feed.shape}.` : ""}
            </span>
          )}
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>By city</h2>
            <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr className="text-xs font-bold text-glass-text-tertiary">
                      <Th align="left">City</Th>
                      <Th align="left">Province or state</Th>
                      <Th align="left">Country</Th>
                      <Th>Requests</Th>
                      <Th>Waitlist sign-ups</Th>
                      <Th>Latest</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.key} style={{ borderTop: "1px solid var(--glass-border)" }}>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{c.name}</span>
                          {c.waitlist && <span className={`${CHIP} ml-2`} style={WAITLIST_CHIP}>Waitlist open</span>}
                        </td>
                        <td className="px-4 py-2.5 text-glass-text-secondary">{c.region ?? "—"}</td>
                        <td className="px-4 py-2.5 text-glass-text-secondary">{c.country ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular font-semibold" style={{ color: "var(--glass-text)" }}>
                          {c.people.size}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular"
                          style={{ color: c.signups ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                          {c.signups === null ? "—" : c.signups}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular whitespace-nowrap text-glass-text-secondary">
                          {when(c.latest).day}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
              Latest requests
              {requests.length > recent.length && (
                <span className="ml-2 text-xs font-normal text-glass-text-tertiary">the {recent.length} most recent</span>
              )}
            </h2>
            <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 640 }}>
                  <thead>
                    <tr className="text-xs font-bold text-glass-text-tertiary">
                      <Th align="left">Date</Th>
                      <Th align="left">Name</Th>
                      <Th align="left">City</Th>
                      <Th align="left">Country</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.ts} style={{ borderTop: "1px solid var(--glass-border)" }}>
                        <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{when(r.at).day}</td>
                        <td className="px-4 py-2.5">
                          <span style={{ color: "var(--glass-text)" }}>{r.name}</span>
                          {r.launcher && <span className={`${CHIP} ml-2`} style={LAUNCHER_CHIP}>City launcher</span>}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>
                          {r.city}{r.region ? <span className="text-glass-text-tertiary">, {r.region}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-glass-text-secondary">{r.country ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every submission of the website&apos;s request-a-city form, read from the #location-requests Slack channel.
        Each person counts once per city, however the city was spelled. A city launcher is someone who tagged
        themselves as offering to launch Brodie in their city. Waitlist open marks a city that already has an open
        waitlist, and waitlist sign-ups is how many have put down its deposit (a region&apos;s waitlist, like the Bay
        Area or the DMV, covers the cities in it); a dash means no waitlist yet. Contact details stay in Slack.
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
