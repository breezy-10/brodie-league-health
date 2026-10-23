import type { CSSProperties } from "react";

// Table headers that stay put under the kit's header while the page scrolls,
// with the darker bar the dashboard's booking table uses so the header reads
// as sitting above the rows it covers. Tinting toward the text colour darkens
// it in light mode and lightens it in dark.
export const STICKY_TH = "sticky top-[var(--shell-top)] z-[5] first:rounded-tl-2xl last:rounded-tr-2xl";
export const STICKY_TH_STYLE: CSSProperties = {
  background: "color-mix(in srgb, var(--glass-text) 9%, var(--glass-surface))",
  boxShadow: "inset 0 -1px 0 var(--glass-border), 0 10px 14px -10px rgba(0,0,0,0.55)",
};

// The box around a wide table. A sticky header sticks to its nearest scroll
// box, so a table that scrolls sideways can't freeze its header against the
// window. This keeps the sideways scroll only on screens too narrow for the
// table: the content column is the window less the pinned sidebar (256px) and
// the page's side padding (52px).
export function tableScrollBox(minWidth: number): string {
  if (minWidth <= 960) return "overflow-x-auto xl:overflow-visible";
  if (minWidth <= 1120) return "overflow-x-auto min-[1440px]:overflow-visible";
  if (minWidth <= 1260) return "overflow-x-auto min-[1580px]:overflow-visible";
  return "overflow-x-auto min-[1720px]:overflow-visible";
}
