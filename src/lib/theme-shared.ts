// Shared between the server (which renders the theme) and the client (which
// toggles it). No next/headers import here, so client components can use it.
export type Theme = "light" | "dark";
export const THEME_COOKIE = "brodie-league-health-theme";
// Where a theme chosen with the old toggle lives. The old script also wrote a
// "blh-theme" cookie for people who never chose, so that cookie can't tell a
// choice from the old dark default; localStorage only held real choices.
export const LEGACY_THEME_STORAGE_KEY = "blh-theme";
// The kit is light-first, so light is what someone who never chose gets.
export const DEFAULT_THEME: Theme = "light";
// The sidebar's pinned/rail choice. A cookie, so the server renders the right
// width and the page doesn't jump sideways on load.
export const SIDEBAR_COOKIE = "brodie-league-health-sidebar";

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : value === "light" ? "light" : DEFAULT_THEME;
}
