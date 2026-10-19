import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sourceClient } from "@/lib/source-apps/clients";
import { seasonKey } from "@/lib/seasons";
import { sameLocation } from "@/lib/location-match";
import StatTile, { type Tone } from "./StatTile";
import { BackToTopButton, ScrollUpButton } from "./ScrollUpButton";

// Referee Bookings: whether the referees are booked for every game night, as
// the referee payroll app's Bookings page tracks it. Each facility booking
// carries a referee status there (referee_bookings, keyed by the facilities
// booking id): booked, booked differently or not needed, and no row reads as
// need to book. A booking whose facility side changed after the referees were
// booked reads as notification required. The rules below are that page's, so
// a night reads the same here as there; this section lays them out like
// Facility Bookings above it.

const REF_PAYROLL_URL = "https://brodie-ref-payroll.vercel.app";

type RefStatus = "notification_required" | "need_to_book" | "booked" | "booked_differently" | "not_needed";
const STATUS_ORDER: RefStatus[] = ["booked", "booked_differently", "not_needed", "notification_required", "need_to_book"];
// A night split into blocks shows the status that most needs someone.
const WEAKEST_FIRST: RefStatus[] = ["notification_required", "need_to_book", "booked_differently", "booked", "not_needed"];
const STATUS_LABEL: Record<RefStatus, string> = {
  booked: "Booked",
  booked_differently: "Booked differently",
  not_needed: "Not needed",
  notification_required: "Notification required",
  need_to_book: "Need to book",
};
const STATUS_STYLE: Record<RefStatus, React.CSSProperties> = {
  booked: { color: "var(--green)", background: "var(--green-tint)" },
  booked_differently: { color: "var(--tag-blue)", background: "var(--tag-blue-bg)" },
  not_needed: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" },
  notification_required: { color: "var(--amber-ink)", background: "var(--amber-tint)" },
  need_to_book: { color: "var(--red)", background: "var(--red-tint)" },
};
// What counts as done: nobody has to do anything more for the night.
const DONE: RefStatus[] = ["booked", "booked_differently", "not_needed"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

type RefNight = { location: string; refLocationId: string; day: string; status: RefStatus };
export type RefereeData = { seasonId: string | null; nights: RefNight[] };

type Booking = {
  id: string; facility_id: string; date: string; start_time: string; end_time: string;
  num_courts: number | null; game_label: string | null; is_off: boolean | null;
};
type RefRow = {
  facility_booking_id: string; status: "booked" | "booked_differently" | "not_needed";
  booking_date: string; booked_start_time: string | null; booked_end_time: string | null; booked_courts: number | null;
};

// Every row of a query, a page of 1,000 at a time (PostgREST's cap).
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await page(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);
// Referees booked against a facility booking that has since moved, changed its
// hours or courts, or been taken off: they need telling. Rows from before the
// copy was kept carry no times and are left alone.
function facilityChanged(row: RefRow | undefined, b: Booking): boolean {
  if (!row || (row.status !== "booked" && row.status !== "booked_differently")) return false;
  if (b.is_off) return true;
  if (row.booked_start_time == null) return false;
  return row.booking_date !== b.date
    || hhmm(row.booked_start_time) !== hhmm(b.start_time)
    || hhmm(row.booked_end_time) !== hhmm(b.end_time)
    || (row.booked_courts ?? null) !== (b.num_courts ?? null);
}
const weakest = (statuses: RefStatus[]): RefStatus => WEAKEST_FIRST.find((s) => statuses.includes(s)) ?? "need_to_book";

// Null when either app can't be reached; an empty list when the season has
// nothing booked yet.
export async function loadRefereeBookings(season: string, locationNames: string[] | null): Promise<RefereeData | null> {
  const fac = sourceClient("facilities");
  const rp = sourceClient("ref_payroll");
  if (!fac || !rp) return null;
  try {
    const [{ data: seasons }, { data: facilities }, { data: locs }] = await Promise.all([
      fac.from("seasons").select("id, name, start_date").order("start_date", { ascending: false }),
      fac.from("facilities").select("id, city, external_facility_ids"),
      rp.from("locations").select("id, name, external_facility_ids").eq("active", true).order("name"),
    ]);
    const s = ((seasons ?? []) as { id: string; name: string | null }[]).find((x) => x.name && seasonKey(x.name) === seasonKey(season));
    if (!s) return { seasonId: null, nights: [] };

    // Each facility under one referee payroll location: the first, by name,
    // sharing a stats venue id with it, as that app does.
    const facRows = (facilities ?? []) as { id: string; city: string | null; external_facility_ids: string[] | null }[];
    const cityOf = new Map(facRows.map((f) => [f.id, f.city]));
    const locByFacility = new Map<string, { id: string; name: string }>();
    for (const l of (locs ?? []) as { id: string; name: string; external_facility_ids: string[] | null }[]) {
      const ext = new Set(l.external_facility_ids ?? []);
      if (!ext.size) continue;
      for (const f of facRows) {
        if (!locByFacility.has(f.id) && (f.external_facility_ids ?? []).some((e) => ext.has(e))) locByFacility.set(f.id, { id: l.id, name: l.name });
      }
    }
    const facilityIds = [...locByFacility.keys()];
    if (!facilityIds.length) return { seasonId: s.id, nights: [] };

    const bookings = await allRows<Booking>((from, to) => (fac as SupabaseClient)
      .from("bookings")
      .select("id, facility_id, date, start_time, end_time, num_courts, game_label, is_off")
      .eq("season_id", s.id).in("facility_id", facilityIds)
      .order("date").order("id").range(from, to));
    if (!bookings.length) return { seasonId: s.id, nights: [] };

    const locIds = [...new Set([...locByFacility.values()].map((l) => l.id))];
    const ids = new Set(bookings.map((b) => b.id));
    const refRows = await allRows<RefRow>((from, to) => (rp as SupabaseClient)
      .from("referee_bookings")
      .select("facility_booking_id, status, booking_date, booked_start_time, booked_end_time, booked_courts")
      .in("location_id", locIds)
      .gte("booking_date", bookings[0].date).lte("booking_date", bookings[bookings.length - 1].date)
      .order("facility_booking_id").range(from, to));
    const refOf = new Map(refRows.filter((r) => ids.has(r.facility_booking_id)).map((r) => [r.facility_booking_id, r]));

    // Nights: a facility's blocks on one date with one game label are one night.
    const byKey = new Map<string, Booking[]>();
    for (const b of bookings) {
      const k = b.game_label ? `${b.facility_id}|${b.date}|${b.game_label}` : `${b.facility_id}|${b.date}|${b.id}`;
      byKey.set(k, [...(byKey.get(k) ?? []), b]);
    }
    const nights: RefNight[] = [];
    for (const blocks of byKey.values()) {
      const isOff = blocks.every((b) => b.is_off);
      // A night off counts only blocks someone had booked referees for (they
      // now need telling); a live night counts every block.
      const counted = isOff ? blocks.filter((b) => refOf.has(b.id)) : blocks.filter((b) => !b.is_off);
      const status = weakest(counted.map((b) => (facilityChanged(refOf.get(b.id), b) ? "notification_required" : refOf.get(b.id)?.status ?? "need_to_book")));
      // Live nights, and a night off still holding referees who need telling.
      if (isOff && status !== "notification_required") continue;
      const first = blocks[0];
      const loc = locByFacility.get(first.facility_id)!;
      const label = cityOf.get(first.facility_id) || loc.name;
      if (locationNames?.length && !locationNames.some((n) => sameLocation(label, n))) continue;
      nights.push({ location: label, refLocationId: loc.id, day: DOW[new Date(`${first.date}T00:00:00Z`).getUTCDay()], status });
    }
    return { seasonId: s.id, nights };
  } catch {
    return null;
  }
}

// Under 80% red, 80 to 99 yellow, all of them green: the Facility Bookings rule.
const pctColor = (pct: number) => (pct < 80 ? "var(--red)" : pct >= 100 ? "var(--green)" : "var(--amber-ink)");
const rowId = (loc: string, day?: string) =>
  `referee-${loc.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}${day ? `-${day.toLowerCase()}` : ""}`;
// Which card a status belongs to: done (green), needs telling (yellow), to book (red).
const toneOf = (s: RefStatus): Tone => (s === "need_to_book" ? "bad" : s === "notification_required" ? "warn" : "ok");

type Cell = { nights: number; done: number; by: Partial<Record<RefStatus, number>> };
const blank = (): Cell => ({ nights: 0, done: 0, by: {} });
const add = (c: Cell, s: RefStatus) => {
  c.nights += 1;
  if (DONE.includes(s)) c.done += 1;
  c.by[s] = (c.by[s] ?? 0) + 1;
};
const cellStatus = (c: Cell): RefStatus => weakest(Object.keys(c.by) as RefStatus[]);

function StatusPill({ s, n }: { s: RefStatus; n?: number }) {
  return (
    <span className="text-[11px] rounded-md px-1.5 py-0.5 whitespace-nowrap" style={STATUS_STYLE[s]}>
      {STATUS_LABEL[s]}{n != null && <> <span className="font-bold tabular">{n}</span></>}
    </span>
  );
}

export function RefereeBookingsSection({ data, season, titleSuffix, headerExtra }: {
  data: RefereeData | null; season: string; titleSuffix?: ReactNode; headerExtra?: ReactNode;
}) {
  // Location -> night -> counts, alphabetical, Monday first.
  const byLoc = new Map<string, { refLocationId: string; days: Map<string, Cell>; all: Cell }>();
  const total = blank();
  for (const n of data?.nights ?? []) {
    let l = byLoc.get(n.location);
    if (!l) { l = { refLocationId: n.refLocationId, days: new Map(), all: blank() }; byLoc.set(n.location, l); }
    if (!l.days.has(n.day)) l.days.set(n.day, blank());
    add(l.days.get(n.day)!, n.status);
    add(l.all, n.status);
    add(total, n.status);
  }
  const locations = [...byLoc.entries()]
    .map(([location, l]) => ({ location, ...l, dayList: [...l.days.entries()].sort((a, b) => DOW_WEEK.indexOf(a[0]) - DOW_WEEK.indexOf(b[0])) }))
    .sort((a, b) => a.location.localeCompare(b.location));
  const dayCount = locations.reduce((n, l) => n + l.dayList.length, 0);
  const pct = total.nights ? Math.round((total.done / total.nights) * 100) : 0;

  // The status cards, as on Facility Bookings: a location whose nights all
  // land in one card is one chip; one whose nights differ splits, naming them.
  const chips = locations.flatMap((l) => {
    const tones = l.dayList.map(([day, c]) => ({ day, tone: toneOf(cellStatus(c)) }));
    const distinct = [...new Set(tones.map((t) => t.tone))];
    if (distinct.length === 1) return [{ location: l.location, text: l.location, tone: distinct[0], href: `#${rowId(l.location)}` }];
    return distinct.map((tn) => {
      const own = tones.filter((t) => t.tone === tn);
      const days = own.map((t) => DAY_FULL[t.day] ?? t.day);
      const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} & ${days[days.length - 1]}` : days[0];
      const target = own[0].day === l.dayList[0][0] ? rowId(l.location) : rowId(l.location, own[0].day);
      return { location: l.location, text: `${l.location} ${list}`, tone: tn, href: `#${target}` };
    });
  });
  const card = (tone: Tone) => chips.filter((c) => c.tone === tone);
  const locsIn = (cs: { location: string }[]) => new Set(cs.map((c) => c.location)).size;
  const ofAll = (n: number) => (locations.length ? `${Math.round((n / locations.length) * 100)}%` : undefined);
  const bookingsHref = (refLocationId: string) => data?.seasonId
    ? `${REF_PAYROLL_URL}/bookings?${new URLSearchParams({ season: data.seasonId, location: refLocationId })}`
    : `${REF_PAYROLL_URL}/bookings`;
  const ROW_MARGIN = "calc(var(--shell-top) + 52px)";

  return (
    <section id="referee-bookings" className="space-y-3" style={{ scrollMarginTop: "calc(var(--shell-top) + 12px)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Referee Bookings</h2>
          {titleSuffix}
          {headerExtra ?? (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, var(--fill-3))", color: "var(--glass-gold)" }}>{season}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={`${REF_PAYROLL_URL}/bookings`} target="_blank" rel="noopener noreferrer" className="br-btn is-outline is-sm shrink-0">
            More details ↗
          </a>
          <BackToTopButton />
        </div>
      </div>

      {!data ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          League Health couldn&apos;t read the referee bookings from the referee payroll and facilities apps.
        </div>
      ) : !locations.length ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No game nights booked for {season} in this scope yet.
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-3 xl:grid-cols-5">
            <div className="md:col-span-3 xl:col-span-2">
              <StatTile
                label="Referees booked"
                value={total.done.toLocaleString()}
                unit={`/ ${total.nights.toLocaleString()} nights`}
                valueSuffix={`${pct}%`}
                valueColor={pctColor(pct)}
                lines={[{ text: "Each location: nights with referees booked / nights" }]}
                pills={locations.map((l) => ({
                  text: `${l.location} ${l.all.done}/${l.all.nights}`,
                  tone: toneOf(cellStatus(l.all)),
                  href: `#${rowId(l.location)}`,
                }))}
                pillsByTone
                pillsEmpty="no locations"
              />
            </div>
            <StatTile label="Booked" value={`${locsIn(card("ok"))}`} unit={`/ ${locations.length}`}
              valueSuffix={ofAll(locsIn(card("ok")))} tone="ok"
              sub="locations with nights booked, booked differently or not needed"
              pills={card("ok").map((c) => ({ text: c.text, tone: c.tone, href: c.href }))} pillsEmpty="none yet" />
            <StatTile label="Notification required" value={`${locsIn(card("warn"))}`} unit={`/ ${locations.length}`}
              valueSuffix={ofAll(locsIn(card("warn")))} tone="warn"
              sub="the facility booking changed after the referees were booked"
              pills={card("warn").map((c) => ({ text: c.text, tone: c.tone, href: c.href }))} pillsEmpty="none" />
            <StatTile label="Need to book" value={`${locsIn(card("bad"))}`} unit={`/ ${locations.length}`}
              valueSuffix={ofAll(locsIn(card("bad")))} tone={card("bad").length ? "bad" : "ok"}
              sub="nobody has confirmed the referees yet"
              pills={card("bad").map((c) => ({ text: c.text, tone: c.tone, href: c.href }))} pillsEmpty="every night has referees" />
          </div>

          <div className="rounded-2xl bg-glass-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-glass-text-tertiary">
                  {[
                    { label: "Location", align: "" },
                    { label: "Night", align: "" },
                    { label: "Nights with referees", align: "text-right" },
                    { label: "Referee status", align: "" },
                  ].map((h) => (
                    <th key={h.label} className={`px-5 py-3 font-bold sticky top-[var(--shell-top)] z-[5] ${h.align}`}
                      style={{
                        background: "color-mix(in srgb, var(--glass-text) 9%, var(--glass-surface))",
                        boxShadow: "inset 0 -1px 0 var(--glass-border), 0 10px 14px -10px rgba(0,0,0,0.55)",
                      }}>
                      {h.label === "Referee status" ? (
                        <div className="flex items-center justify-between gap-3">
                          <span>{h.label}</span>
                          <ScrollUpButton targetId="referee-bookings" label="Back up to the referee cards" />
                        </div>
                      ) : h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locations.flatMap((l) => l.dayList.map(([day, c], i) => {
                  const p = c.nights ? Math.round((c.done / c.nights) * 100) : 0;
                  return (
                    <tr key={`${l.location}|${day}`} id={i === 0 ? rowId(l.location) : rowId(l.location, day)}
                      style={{ scrollMarginTop: ROW_MARGIN }}
                      className={`align-top border-t ${i === 0 ? "border-glass-border" : "border-glass-border-light"}`}>
                      {i === 0 && (
                        <td rowSpan={l.dayList.length} className="px-5 py-3 whitespace-nowrap align-top font-semibold" style={{ color: "var(--glass-text)" }}>
                          <a href={bookingsHref(l.refLocationId)} target="_blank" rel="noopener noreferrer" className="hover:underline"
                            title={`Open ${l.location}'s ${season} referee bookings on the referee payroll site`}>
                            {l.location}<span className="ml-1 text-[11px] font-normal text-glass-text-tertiary">↗</span>
                          </a>
                        </td>
                      )}
                      <td className="px-5 py-3 whitespace-nowrap font-semibold" style={{ color: "var(--glass-text)" }}>{day}</td>
                      <td className="px-5 py-3 text-right tabular font-bold" style={{ color: pctColor(p) }}>
                        {c.done}/{c.nights}
                        <div className="text-[11px] font-normal text-glass-text-tertiary">{p}%</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {STATUS_ORDER.filter((s) => c.by[s]).map((s) => <StatusPill key={s} s={s} n={c.by[s]} />)}
                        </div>
                      </td>
                    </tr>
                  );
                }))}
                {locations.length > 1 && (
                  <tr className="align-top" style={{ borderTop: "2px solid var(--glass-border)" }}>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="font-bold" style={{ color: "var(--glass-text)" }}>Total</div>
                      <div className="text-xs text-glass-text-tertiary mt-0.5">{locations.length} locations</div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-glass-text-tertiary">{dayCount} days</td>
                    <td className="px-5 py-3 text-right tabular font-bold" style={{ color: pctColor(pct) }}>
                      {total.done}/{total.nights}
                      <div className="text-[11px] font-normal text-glass-text-tertiary">{pct}%</div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {STATUS_ORDER.filter((s) => total.by[s]).map((s) => <StatusPill key={s} s={s} n={total.by[s]} />)}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
            Every game night booked at a facility linked to a referee payroll location, for {season}. A night counts as
            having referees when they are booked, booked differently or not needed; notification required means the
            facility booking changed after the referees were booked. Read live from the referee payroll app&apos;s
            Bookings page.
          </p>
        </>
      )}
    </section>
  );
}
