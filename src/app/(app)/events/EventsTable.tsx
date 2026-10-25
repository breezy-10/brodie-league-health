"use client";

import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { TZ_SHORT } from "@/lib/tz";
import { STICKY_TH_STYLE, stickyTh, tableScrollBox } from "../dashboard/stickyTable";
import { CheckinNote, pct } from "./events-ui";
import type { EventRow } from "./EventsView";

// Someone who RSVP'd to an event or was checked in at it (the promo feed's
// ?view=people). going is null for a check-in without an RSVP and false for a
// cancelled one.
export type EventPerson = {
  event_id: string;
  name: string;
  going: boolean | null;
  is_new: boolean;
  checked_in_at: string | null; // the event's own local time, "YYYY-MM-DDTHH:MM"
  registered_after: boolean;
};

// Read from the string: it is already the event's own clock, and Date would
// shift it into the viewer's zone.
function whenLabel(at: string | null, tz: string): { day: string; time: string } {
  if (!at) return { day: "Date to be set", time: "" };
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
  const [hh, mm] = at.slice(11, 16).split(":").map(Number);
  const time = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}${TZ_SHORT[tz] ? ` ${TZ_SHORT[tz]}` : ""}`;
  return { day, time };
}

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const GREY: React.CSSProperties = { color: "var(--glass-text-secondary)", background: "var(--fill-3)" };
const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1 text-[11px] font-semibold "
  + "text-glass-text-tertiary hover:text-glass-text hover:border-glass-gold hover:bg-glass-surface-hover transition "
  + "disabled:opacity-40 disabled:pointer-events-none";
// Going first, then anyone let in without an RSVP, then cancellations; by name
// within each.
const rank = (p: EventPerson) => (p.going ? 0 : p.going === null ? 1 : 2);

// One section's events (a day, or a location), with its own total. Every
// section of the page shares the columns (anyPaid comes from the whole list)
// so they line up. Each event opens to its people; the toolbar's toggle opens
// or closes them all.
export default function EventsTable({ title, events, people, past, live, anyPaid }: {
  title: string; events: EventRow[]; people: Record<string, EventPerson[]>;
  past: boolean; live: boolean; anyPaid: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = events.length > 0 && events.every((e) => open[e.id]);
  const setAll = (to: boolean) => setOpen(Object.fromEntries(events.map((e) => [e.id, to])));

  const sum = (k: keyof EventRow) => events.reduce((s, e) => s + ((e[k] as number) ?? 0), 0);
  const going = sum("going"), rsvps = sum("rsvps"), newPlayers = sum("new_players"), converted = sum("converted");
  const paid = sum("paid");
  const checkedIn = sum("checked_in"), checkedInGoing = sum("checked_in_going"), checkedInNew = sum("checked_in_new");
  // Fixed widths, the same in every section, so the columns line up from one
  // table to the next whatever each holds. Past and Paid add a column to every
  // section alike, so the shares are worked out from the columns shown.
  const cols: [string, number][] = [
    ["date", 15], ["event", 27], ["location", 18], ["going", 12],
    ...(past ? [["became", 11] as [string, number]] : []),
    ...(anyPaid ? [["paid", 6] as [string, number]] : []),
    ["checked", 13],
  ];
  const totalWeight = cols.reduce((n, [, w]) => n + w, 0);
  return (
    <div className="rounded-2xl bg-glass-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <span className="text-sm font-bold" style={{ color: "var(--glass-text)" }}>{title}</span>
        <span className="text-xs text-glass-text-tertiary">
          {events.length.toLocaleString()} {events.length === 1 ? "event" : "events"}
        </span>
        {/* One toggle: the label always names what the click does, as on
            Discounts. */}
        <button type="button" onClick={() => setAll(!allOpen)} className={`${TOOL_BTN} ml-auto`}>
          {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {/* The header sticks to the window, which an overflow box would
          trap, so the table only scrolls sideways where it can't fit
          (below xl). */}
      <div className={tableScrollBox(860)}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 860, tableLayout: "fixed" }}>
          <colgroup>
            {cols.map(([k, w]) => <col key={k} style={{ width: `${((100 * w) / totalWeight).toFixed(2)}%` }} />)}
          </colgroup>
          <thead>
            <tr className="text-xs font-bold text-glass-text-tertiary">
              <Th align="left">Date</Th>
              <Th align="left">Event</Th>
              <Th align="left">Location</Th>
              <Th>Going</Th>
              {past && <Th>Became registrations</Th>}
              {anyPaid && <Th>Paid</Th>}
              <Th>Checked in</Th>
            </tr>
          </thead>
          <tbody>
            {events.flatMap((e) => {
              const w = whenLabel(e.starts_at, e.timezone);
              const isOpen = !!open[e.id];
              const ppl = [...(people[e.id] ?? [])].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
              const row = (
                <tr key={e.id} style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <td className="px-4 py-2.5 whitespace-nowrap align-top">
                    <span className="flex items-start gap-1.5">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} who's going to ${e.name}`}
                        className="shrink-0 -ml-1 mt-0.5 px-1 py-0.5 rounded hover:bg-glass-surface-hover focus-visible:outline focus-visible:outline-2"
                        style={{ color: "var(--glass-text-tertiary)" }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
                          className="transition-transform duration-150"
                          style={{ transform: isOpen ? "rotate(180deg)" : undefined }}>
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <span>
                        <span className="block" style={{ color: "var(--glass-text)" }}>{w.day}</span>
                        <span className="block text-[11px] text-glass-text-tertiary tabular">
                          {w.time}
                          {live && e.ends_at && <> to {whenLabel(e.ends_at, e.timezone).time.replace(/ [A-Z]{3}$/, "")}</>}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{e.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className={CHIP} style={GREY}>{e.kind}</span>
                      {e.is_private && <span className={CHIP} style={GREY}>Private</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <div style={{ color: "var(--glass-text)" }}>{e.location}</div>
                    {e.venue && e.venue !== e.location && (
                      <div className="text-[11px] text-glass-text-tertiary">{e.venue}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular align-top whitespace-nowrap">
                    <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{e.going.toLocaleString()}</div>
                    <div className="text-[11px] text-glass-text-tertiary">of {e.rsvps.toLocaleString()} RSVPs</div>
                    <div className="text-[11px]" style={{ color: e.new_players ? "var(--glass-text-secondary)" : "var(--glass-text-tertiary)" }}>
                      {e.new_players.toLocaleString()} new to Brodie
                    </div>
                  </td>
                  {past && (
                    <td className="px-4 py-2.5 text-right tabular align-top whitespace-nowrap">
                      <div style={{ color: "var(--glass-text)" }}>{pct(e.converted, e.new_players)}</div>
                      <div className="text-[11px] text-glass-text-tertiary">{e.converted} of {e.new_players}</div>
                    </td>
                  )}
                  {anyPaid && (
                    <td className="px-4 py-2.5 text-right tabular align-top" style={{ color: "var(--glass-text)" }}>
                      {e.paid ? e.paid.toLocaleString() : "—"}
                    </td>
                  )}
                  {/* Nobody is checked in to an event that hasn't started. */}
                  <td className="px-4 py-2.5 text-right tabular align-top whitespace-nowrap">
                    {e.upcoming ? (
                      <span className="text-glass-text-tertiary">—</span>
                    ) : (
                      <>
                        <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{(e.checked_in ?? 0).toLocaleString()}</div>
                        <div className="text-[11px] text-glass-text-tertiary">
                          <CheckinNote going={e.going} checkedInGoing={e.checked_in_going ?? 0} checkedIn={e.checked_in ?? 0}
                            checkedInNew={e.checked_in_new} />
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
              if (!isOpen) return [row];
              if (!ppl.length) {
                return [row, (
                  <tr key={`${e.id}-none`} style={{ background: "var(--glass-surface-hover)" }}>
                    <td />
                    <td colSpan={cols.length - 1} className="px-4 py-2.5 text-xs italic text-glass-text-tertiary">
                      {e.upcoming ? "No RSVPs yet." : "Nobody RSVP'd or was checked in."}
                    </td>
                  </tr>
                )];
              }
              // One line per person, under the columns their details belong to.
              return [row, ...ppl.map((p, i) => (
                <tr key={`${e.id}-${i}`} style={{ background: "var(--glass-surface-hover)" }}>
                  <td />
                  <td colSpan={2} className="px-4 py-1.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span style={{ color: p.going === false ? "var(--glass-text-tertiary)" : "var(--glass-text)" }}>{p.name}</span>
                      {p.is_new && <span className={CHIP} style={{ color: "var(--amber-ink)", background: "var(--amber-tint)" }}>New</span>}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right text-xs whitespace-nowrap"
                    style={{ color: p.going ? "var(--glass-text-secondary)" : "var(--glass-text-tertiary)" }}>
                    {p.going ? "Going" : p.going === false ? "Cancelled" : "No RSVP"}
                  </td>
                  {past && (
                    <td className="px-4 py-1.5 text-right">
                      {p.going && p.is_new && p.registered_after && (
                        <span className={CHIP} style={{ color: "var(--green)", background: "var(--green-tint)" }}>Registered</span>
                      )}
                    </td>
                  )}
                  {anyPaid && <td />}
                  <td className="px-4 py-1.5 text-right whitespace-nowrap">
                    {e.upcoming ? null : p.checked_in_at ? (
                      <span className={CHIP} style={{ color: "var(--green)", background: "var(--green-tint)" }}>
                        In · {whenLabel(p.checked_in_at, e.timezone).time.replace(/ [A-Z]{3}$/, "")}
                      </span>
                    ) : (
                      <span className="text-xs text-glass-text-tertiary">Not checked in</span>
                    )}
                  </td>
                </tr>
              ))];
            })}
            {/* A total of one row only repeats it. */}
            {events.length > 1 && (
              <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                <td className="px-4 py-3 font-bold whitespace-nowrap align-top" style={{ color: "var(--glass-text)" }} colSpan={3}>
                  Total
                  <span className="ml-2 text-xs font-normal text-glass-text-tertiary">
                    {events.length.toLocaleString()} {events.length === 1 ? "event" : "events"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular align-top whitespace-nowrap">
                  <div className="font-bold" style={{ color: "var(--glass-text)" }}>{going.toLocaleString()}</div>
                  <div className="text-[11px] text-glass-text-tertiary">of {rsvps.toLocaleString()} RSVPs</div>
                  <div className="text-[11px]" style={{ color: newPlayers ? "var(--glass-text-secondary)" : "var(--glass-text-tertiary)" }}>
                    {newPlayers.toLocaleString()} new to Brodie
                  </div>
                </td>
                {past && (
                  <td className="px-4 py-3 text-right tabular align-top whitespace-nowrap">
                    <div className="font-bold" style={{ color: "var(--glass-text)" }}>{pct(converted, newPlayers)}</div>
                    <div className="text-[11px] text-glass-text-tertiary">{converted} of {newPlayers}</div>
                  </td>
                )}
                {anyPaid && (
                  <td className="px-4 py-3 text-right tabular align-top font-bold" style={{ color: "var(--glass-text)" }}>
                    {paid ? paid.toLocaleString() : "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-right tabular align-top whitespace-nowrap">
                  {past || live ? (
                    <>
                      <div className="font-bold" style={{ color: "var(--glass-text)" }}>{checkedIn.toLocaleString()}</div>
                      <div className="text-[11px] text-glass-text-tertiary">
                        <CheckinNote going={going} checkedInGoing={checkedInGoing} checkedIn={checkedIn} checkedInNew={checkedInNew} />
                      </div>
                    </>
                  ) : (
                    <span className="text-glass-text-tertiary">—</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold ${stickyTh(860)}`} style={STICKY_TH_STYLE}>
      {children}
    </th>
  );
}
