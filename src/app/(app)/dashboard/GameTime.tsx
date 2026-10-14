"use client";

import { useEffect, useState } from "react";
import { TZ_SHORT } from "@/lib/tz";

// A game time in the viewer's own time zone, with the venue's in brackets when
// they differ ("10:00–11:00 pm ET (7:00–8:00 pm PT)"). The server doesn't know
// the viewer's zone, so the first render (server and client alike) is the
// venue's time with its zone named explicitly, and the browser switches to its
// own zone once mounted; rendering the viewer's zone straight away would make
// the server and browser disagree and React rebuild the page.
type Mode = "slot" | "start" | "startZone";

function zoneLabel(iso: string, tz: string): string {
  if (TZ_SHORT[tz]) return TZ_SHORT[tz];
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
function clock(iso: string, tz: string, withPeriod: boolean): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
  return withPeriod ? `${h}:${m} ${period}` : `${h}:${m}`;
}
function render(start: string, end: string | undefined, tz: string, mode: Mode): string {
  const zone = zoneLabel(start, tz);
  if (mode === "start") return clock(start, tz, true);
  if (mode === "startZone" || !end) return `${clock(start, tz, true)}${zone ? ` ${zone}` : ""}`;
  return `${clock(start, tz, false)}–${clock(end, tz, true)}${zone ? ` ${zone}` : ""}`;
}

export default function GameTime({ start, end, tz, mode = "slot" }: {
  start: string; end?: string; tz: string; mode?: Mode;
}) {
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    try { setViewer(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* keep the venue's */ }
  }, []);

  const venue = render(start, end, tz, mode);
  if (!viewer) return <>{venue}</>;
  const mine = render(start, end, viewer, mode);
  // Same wall clock and zone label: one time is enough.
  const same = render(start, end, viewer, "slot") === render(start, end, tz, "slot");
  if (same) return <>{venue}</>;
  // The start chip is narrow: the viewer's time, with the venue's on hover.
  if (mode === "start") return <span title={`${render(start, end, tz, "startZone")} at the venue`}>{mine}</span>;
  return <>{mine} <span className="opacity-70">({venue})</span></>;
}
