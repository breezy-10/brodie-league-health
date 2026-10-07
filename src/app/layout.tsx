import "./globals.css";
// The Brodie Design Library kit, after the app's own CSS as the kit asks,
// then this app's dark layer over it.
import "@/styles/brodie/tokens.css";
import "@/styles/brodie/bundle.css";
import "@/styles/brodie/dark.css";
import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { ThemeScript } from "@/components/ThemeScript";
import { getTheme } from "@/lib/theme";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "League Health | Brodie",
  description: "Daily ops scoreboard for league managers.",
};

// The browser chrome matches the ground of the theme in use. viewport-fit=cover
// lets the glass header and tab bar run under the notch and home indicator,
// which pad themselves with the safe-area insets.
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return { themeColor: theme === "dark" ? "#141414" : "#f5f5f7", viewportFit: "cover" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered from the cookie, so the first paint is already the user's theme
  // and React's tree agrees with the DOM. suppressHydrationWarning covers the
  // one case the cookie cannot: a first visit that ThemeScript migrates.
  const theme = await getTheme();
  return (
    // The font variables sit on <html>, not <body>: the kit's --font-sans is
    // declared on :root and resolves var(--font-inter) there.
    <html lang="en" data-theme={theme} className={`${inter.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
