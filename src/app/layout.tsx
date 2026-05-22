import "./globals.css";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Brodie League Health",
  description: "Daily ops scoreboard for league managers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-brodie-ink text-brodie-fg">
        <Nav />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</div>
      </body>
    </html>
  );
}
