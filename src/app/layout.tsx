import "./globals.css";
import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeScript } from "@/components/ThemeScript";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered by the server from the cookie ThemeScript/ThemeToggle keep, so the
  // theme is part of React's own tree and survives a full re-render of the
  // document. Dark is the default, same as ThemeScript.
  const saved = (await cookies()).get("blh-theme")?.value;
  const theme = saved === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${inter.variable} ${plexMono.variable} min-h-screen bg-glass-bg text-glass-text font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
