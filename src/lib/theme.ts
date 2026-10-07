import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type Theme } from "@/lib/theme-shared";

// The theme lives in a cookie so the server can render it. With localStorage
// alone the server had to guess, and any hydration error made React rebuild
// the document from the server's guess, silently resetting a chosen theme.
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
