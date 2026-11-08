import type { CSSProperties } from "react";

// Table headers that stay put under the kit's header while the page scrolls,
// with the darker bar the dashboard's booking table uses so the header reads
// as sitting above the rows it covers. Tinting toward the text colour darkens
// it in light mode and lightens it in dark. The freezing itself is
// components/FrozenTables.tsx, on every table at every width, so a wide table
// just scrolls sideways in an overflow-x-auto box.
export const STICKY_TH_STYLE: CSSProperties = {
  background: "color-mix(in srgb, var(--glass-text) 9%, var(--glass-surface))",
  boxShadow: "inset 0 -1px 0 var(--glass-border), 0 10px 14px -10px rgba(0,0,0,0.55)",
};

// Header cells on that bar round off the card's top corners.
export const TH_CORNERS = "first:rounded-tl-2xl last:rounded-tr-2xl";
