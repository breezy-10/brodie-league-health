import type { CSSProperties } from "react";

// Table headers that stay put under the kit's header while the page scrolls,
// with the darker bar the dashboard's booking table uses so the header reads
// as sitting above the rows it covers. Tinting toward the text colour darkens
// it in light mode and lightens it in dark.
export const STICKY_TH_STYLE: CSSProperties = {
  background: "color-mix(in srgb, var(--glass-text) 9%, var(--glass-surface))",
  boxShadow: "inset 0 -1px 0 var(--glass-border), 0 10px 14px -10px rgba(0,0,0,0.55)",
};

// A sticky header sticks to its nearest scroll box, so a table that scrolls
// sideways can't freeze its header against the window: inside that box the
// header's offset (the kit header's height) only slides it down over the first
// row. So a wide table scrolls sideways only on screens too narrow for it, and
// its header sticks only on screens wide enough not to. The content column is
// the window less the pinned sidebar (256px) and the page's side padding
// (52px). Each tier's classes are written out in full for Tailwind to find.
const TIERS = [
  { upTo: 960, box: "overflow-x-auto xl:overflow-visible", th: "xl:sticky xl:top-[var(--shell-top)]" },
  { upTo: 1120, box: "overflow-x-auto min-[1440px]:overflow-visible", th: "min-[1440px]:sticky min-[1440px]:top-[var(--shell-top)]" },
  { upTo: 1260, box: "overflow-x-auto min-[1580px]:overflow-visible", th: "min-[1580px]:sticky min-[1580px]:top-[var(--shell-top)]" },
  { upTo: Infinity, box: "overflow-x-auto min-[1720px]:overflow-visible", th: "min-[1720px]:sticky min-[1720px]:top-[var(--shell-top)]" },
];
const tier = (minWidth: number) => TIERS.find((t) => minWidth <= t.upTo)!;

// The box around a table of this minimum width.
export function tableScrollBox(minWidth: number): string {
  return tier(minWidth).box;
}

// A header cell for a table of this minimum width: sticky from the same
// screen width its box stops scrolling sideways.
export function stickyTh(minWidth: number): string {
  return `${tier(minWidth).th} z-[5] first:rounded-tl-2xl last:rounded-tr-2xl`;
}
