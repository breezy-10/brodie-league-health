import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export async function Nav() {
  const ctx = await getCurrentUser();
  const role = ctx?.profile?.role;
  const isAdmin = role === "dm" || role === "super_admin";

  return (
    <nav className="border-b border-brodie-line bg-black/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-6 text-sm">
        <Link href="/" className="font-display font-bold text-base">League Health</Link>
        <Link href="/" className="text-brodie-dim hover:text-white">My day</Link>
        <Link href="/leaderboard" className="text-brodie-dim hover:text-white">Leaderboard</Link>
        {isAdmin && <Link href="/admin" className="text-brodie-accent hover:opacity-90">Admin</Link>}
        {isAdmin && <Link href="/admin/roster" className="text-brodie-dim hover:text-white">Roster</Link>}
        <span className="ml-auto text-brodie-dim text-xs">{ctx?.user?.email}</span>
      </div>
    </nav>
  );
}
