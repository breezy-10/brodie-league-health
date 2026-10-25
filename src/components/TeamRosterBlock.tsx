// One team's roster with what each player has paid — the block the Ambassadors
// expander and the discount drill-down both open, so the two read identically.

import Link from "next/link";
import { normName } from "@/lib/names";
import { shortDiscount } from "@/lib/discount-names";

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)";

export type RosterLine = {
  player: string;
  // Ops player id (absent from an older feed).
  player_id?: string;
  is_captain: boolean;
  paid: number;
  total: number;
  currency: string | null;
  paid_ok: boolean;
  no_registration: boolean;
  // The discount on their registration and what it was for. Optional so an
  // older feed without them still renders.
  discount?: number;
  discount_names?: string | null;
  // How they got onto the team (absent from an older feed).
  joined_via?: JoinedVia;
};

// How a player got onto an ambassador team, from their registration: as its
// captain; with the captain's team code or roster invite; as a free agent who
// picked the team in the "join an ambassador team" step of the free-agent
// sign-up, or one placed on it by staff; moved over by staff from the team
// they signed up for; or a team registration with no code. "free_agent" is
// what the feed sent before it told picked from placed.
export type JoinedVia =
  | "captain" | "team_code" | "free_agent" | "free_agent_picked" | "free_agent_placed" | "moved" | "no_code" | null;
const JOINED: Partial<Record<NonNullable<JoinedVia>, { label: string; color: string }>> = {
  free_agent: { label: "Free agent", color: "var(--green)" },
  free_agent_picked: { label: "Free agent, picked the team", color: "var(--green)" },
  free_agent_placed: { label: "Free agent, placed by staff", color: "var(--glass-text-secondary)" },
  moved: { label: "Moved here by staff", color: "var(--glass-text-tertiary)" },
  team_code: { label: "Captain's code", color: "var(--glass-text-tertiary)" },
  no_code: { label: "Joined without a code", color: "var(--glass-text-tertiary)" },
};
export function JoinedTag({ via }: { via?: JoinedVia }) {
  const j = via ? JOINED[via] : undefined;
  return j ? <span style={{ color: j.color }}> · {j.label}</span> : null;
}
// Free agents who chose the team themselves, and those staff put there.
export const pickedTeam = (v?: JoinedVia) => v === "free_agent_picked" || v === "free_agent";
export const placedOnTeam = (v?: JoinedVia) => v === "free_agent_placed";

export type RosterTeam = {
  team: string;
  location: string;
  day: string | null;
  division: string | null;
  players: number;
  roster: RosterLine[];
};

// Someone with a price to pay reads bright, their amount in gold; anyone on a
// free registration (or with no registration on file) owes nothing and recedes.
const owes = (x: RosterLine) => !x.no_registration && x.total > 0;

function money(x: RosterLine) {
  if (x.no_registration) return "no reg";
  const cur = x.currency ? ` ${x.currency.toUpperCase()}` : "";
  return `$${Math.round(x.paid)} / $${Math.round(x.total)}${cur}`;
}

// Marks someone on the training site's staff roster; the hover says their role
// and home venue so a same-name player can be told apart.
export function StaffBadge({ label }: { label: string }) {
  return (
    <span
      className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded align-middle cursor-help"
      style={{ background: "var(--ok-soft)", color: "var(--ok-on)" }}
      title={label}
    >
      Staff
    </span>
  );
}

export default function TeamRosterBlock({
  team: t, note, staff, hrefFor,
}: {
  team: RosterTeam;
  note?: string;
  // Normalised name -> role label, from the training roster. Omit to show no tags.
  staff?: Record<string, string>;
  // Where a player's name links, if anywhere (the discounts team view opens
  // the player in its player view).
  hrefFor?: (x: RosterLine) => string | null;
}) {
  // Captain first, then whoever has paid least, so the chase list is on top.
  const ordered = [...t.roster].sort(
    (a, b) =>
      Number(b.is_captain) - Number(a.is_captain) ||
      a.paid - b.paid ||
      a.player.localeCompare(b.player),
  );
  const paid = t.roster.filter((x) => x.paid_ok).length;
  // Only a team where somebody took a discount gets the extra column, and the
  // lines widen by exactly that much so name and amount stay under the header.
  const hasDiscounts = t.roster.some((x) => (x.discount ?? 0) > 0);
  const lineWidth = hasDiscounts ? "calc(42rem + 292px)" : "42rem";
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 max-w-2xl">
        <span
          className="inline-block w-1 h-3.5 rounded-sm align-middle shrink-0"
          style={{ background: t.players === 0 ? "var(--glass-red)" : t.players === 1 ? THIN : GOLD }}
        />
        <span className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{t.team}</span>
        <span className="text-xs text-glass-text-tertiary">
          {t.location} &middot; {t.day ?? "no night"}
          {t.division ? ` · ${t.division}` : ""}
        </span>
        <span
          className="text-xs tabular ml-auto shrink-0"
          // Everyone paid reads green; anything short of that stays muted.
          style={{ color: t.roster.length && paid === t.roster.length ? "var(--glass-success-text)" : THIN }}
        >
          {t.roster.length ? `${paid} of ${t.roster.length} paid` : "—"}
        </span>
      </div>
      {note && <p className="mt-0.5 text-[11px] italic text-glass-text-tertiary max-w-2xl">{note}</p>}
      {ordered.length === 0 ? (
        <p className="mt-1 text-[12px] italic text-glass-text-tertiary">No players on this roster yet.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {ordered.map((x, i) => (
            <li key={`${x.player}-${i}`} className="flex items-baseline gap-3 text-[12px]" style={{ maxWidth: lineWidth }}>
              <span className="truncate flex-1"
                style={{ color: owes(x) ? "var(--glass-text)" : "var(--glass-text-secondary)" }}>
                {(() => {
                  const href = hrefFor?.(x);
                  return href ? <Link href={href} className="hover:underline">{x.player}</Link> : x.player;
                })()}
                {x.is_captain && <span className="text-glass-text-tertiary"> (C)</span>}
                {staff?.[normName(x.player)] && <StaffBadge label={staff[normName(x.player)]} />}
                {!x.is_captain && <JoinedTag via={x.joined_via} />}
              </span>
              <span
                className="tabular shrink-0 w-[128px] text-right"
                style={{ color: owes(x) ? GOLD : "var(--glass-text-secondary)" }}
                title={x.no_registration ? "No registration on file" : undefined}
              >
                {money(x)}
              </span>
              {hasDiscounts && (
                <span className="shrink-0 w-[280px] truncate"
                  title={x.discount_names ?? undefined}>
                  {(x.discount ?? 0) > 0 && (
                    <>
                      <span className="tabular font-bold" style={{ color: GOLD }}>
                        {"\u2212"}${Math.round(x.discount!)}
                      </span>
                      <span style={{ color: "var(--glass-text-secondary)" }}>
                        {" \u00b7 "}{x.discount_names ? shortDiscount(x.discount_names) : "code removed"}
                      </span>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
