import { getCurrentUser } from "@/lib/auth";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";

const BRODIE_B_LOGO =
  "https://cdn.prod.website-files.com/6921d2c2bd3b56136200df40/69a89a46fa2d0409248fc26f_brodie-b-white.svg";

type NavItem = { href: string; label: string; exact?: boolean };
const NAV_BASE: NavItem[] = [
  { href: "/",             label: "My day",      exact: true },
  { href: "/leaderboard",  label: "Leaderboard" },
  { href: "/achievements", label: "Trophies"    },
];
const NAV_ADMIN: NavItem[] = [
  { href: "/district",           label: "District" },
  { href: "/district/disputes",  label: "Disputes" },
];
// Dashboard sits at the far LEFT of the admin bar; Settings at the far right.
// Both are admin-only. Roster/Users + Audit live as cards inside Settings.
const NAV_DASHBOARD: NavItem = { href: "/dashboard", label: "Dashboard" };
const NAV_SETTINGS: NavItem = { href: "/settings", label: "Settings" };

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  dm: "District Manager",
  lm: "League Manager",
};

export async function Nav() {
  const ctx = await getCurrentUser();
  const role = ctx?.profile?.role ?? "lm";
  const isAdmin = role === "dm" || role === "super_admin";
  // Dashboard pinned far left, Settings far right — admin bar only.
  const items = isAdmin
    ? [NAV_DASHBOARD, ...NAV_BASE, ...NAV_ADMIN, NAV_SETTINGS]
    : NAV_BASE;
  const fullName = ctx?.profile?.full_name ?? ctx?.user?.email ?? "—";

  return (
    <header
      className="app-nav flex items-stretch px-3 sm:px-6"
      style={{
        height: 56,
        flexShrink: 0,
        background: "var(--glass-background)",
        borderBottom: "1px solid var(--glass-border-light)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div className="flex items-center gap-3 h-full select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRODIE_B_LOGO}
          alt="Brodie"
          className="brodie-logo"
          style={{ height: 22, width: "auto", display: "block" }}
        />
        <span
          className="text-[13px] font-bold tracking-[0.04em] uppercase hidden sm:inline"
          style={{ color: "var(--glass-gold)" }}
        >
          League Health
        </span>
      </div>

      <nav
        className="flex items-stretch gap-1 h-full ml-3 sm:ml-6 overflow-x-auto no-scrollbar"
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} exact={item.exact} />
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-4 h-full">
        <div className="hidden sm:flex flex-col items-end leading-tight">
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--glass-text)" }}>
            {fullName}
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--glass-gold)",
              fontWeight: 600,
            }}
          >
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
