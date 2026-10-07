"use client";

import { LEGACY_THEME_STORAGE_KEY, THEME_COOKIE, type Theme } from "@/lib/theme-shared";

// A row in the account menu. The shell owns the current theme: the menu
// unmounts when it closes, so a toggle that kept its own state would reopen
// showing the theme the page loaded with.
export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try {
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, next);
    } catch {}
    onChange(next);
  }

  return (
    <button type="button" role="menuitem" onClick={toggle}>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
