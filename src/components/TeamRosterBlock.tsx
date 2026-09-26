// One team's roster with what each player has paid — the block the Ambassadors
// expander and the discount drill-down both open, so the two read identically.

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)";

export type RosterLine = {
  player: string;
  is_captain: boolean;
  paid: number;
  total: number;
  currency: string | null;
  paid_ok: boolean;
  no_registration: boolean;
};

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

export default function TeamRosterBlock({ team: t, note }: { team: RosterTeam; note?: string }) {
  // Captain first, then whoever has paid least, so the chase list is on top.
  const ordered = [...t.roster].sort(
    (a, b) =>
      Number(b.is_captain) - Number(a.is_captain) ||
      a.paid - b.paid ||
      a.player.localeCompare(b.player),
  );
  const paid = t.roster.filter((x) => x.paid_ok).length;
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
          style={{ color: t.roster.length && paid === t.roster.length ? "var(--glass-text-secondary)" : THIN }}
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
            <li key={`${x.player}-${i}`} className="flex items-baseline gap-3 text-[12px] max-w-2xl">
              <span className="truncate flex-1"
                style={{ color: owes(x) ? "var(--glass-text)" : "var(--glass-text-secondary)" }}>
                {x.player}
                {x.is_captain && <span className="text-glass-text-tertiary"> (C)</span>}
              </span>
              <span
                className="tabular font-mono shrink-0 w-[128px] text-right"
                style={{ color: owes(x) ? GOLD : "var(--glass-text-secondary)" }}
                title={x.no_registration ? "No registration on file" : undefined}
              >
                {money(x)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
