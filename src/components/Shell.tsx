import { cookies } from "next/headers";
import { canManageUsers, getCurrentUser } from "@/lib/auth";
import AppShell, { type NavItem, type SidebarMode } from "@/components/AppShell";
import { SIDEBAR_COOKIE } from "@/lib/theme-shared";
import { CITY_LAUNCHER_ROLES } from "@/lib/city-launchers";
import { getTheme } from "@/lib/theme";

// The pages people open daily first with no heading, then sentence-case
// groups (kit Sidebar).
const DASHBOARD: NavItem = { href: "/dashboard", label: "Dashboard", short: "Dashboard", icon: "dashboard", group: "" };
const LIVE: NavItem = { href: "/live-games", label: "Live games", short: "Live", icon: "live", group: "" };
const REGISTRATIONS: NavItem = { href: "/registrations", label: "Registrations", short: "Signups", icon: "registrations", group: "" };
const REFERRALS: NavItem = { href: "/referrals", label: "Referrals", short: "Referrals", icon: "referrals", group: "" };
const DISCOUNTS: NavItem = { href: "/discounts", label: "Discounts", short: "Discounts", icon: "discounts", group: "" };
const AMBASSADORS: NavItem = { href: "/ambassador-teams", label: "Ambassador teams", short: "Ambassadors", icon: "ambassadors", group: "" };
// On trial before it replaces Ambassador teams; super admins only until then.
const AMBASSADORS_V2: NavItem = { href: "/ambassador-teams-v2", label: "Ambassador teams v2", short: "Ambassadors v2", icon: "ambassadors", group: "" };
const FORFEIT: NavItem = { href: "/forfeit-risk", label: "Forfeit risk", short: "Forfeits", icon: "forfeit", group: "" };
const DROP_INS: NavItem = { href: "/drop-ins", label: "Drop-ins", short: "Drop-ins", icon: "dropins", group: "" };
const EVENTS: NavItem = { href: "/events", label: "Events", short: "Events", icon: "events", group: "" };
const CHECK_INS: NavItem = { href: "/check-ins", label: "Check-ins", short: "Check-ins", icon: "checkins", group: "" };
const WAITLIST: NavItem = { href: "/waitlist", label: "Waitlist", short: "Waitlist", icon: "waitlist", group: "" };
const CITIES: NavItem = { href: "/requested-cities", label: "Requested cities", short: "Cities", icon: "cities", group: "" };
const LAUNCHERS: NavItem = { href: "/city-launchers", label: "City launchers", short: "Launchers", icon: "launchers", group: "" };
const STAFF: NavItem = { href: "/staff-performance", label: "Staff performance", short: "Staff", icon: "staff", group: "People" };
const MY_DAY: NavItem = { href: "/my-day", label: "My day", short: "My day", icon: "myday", group: "People" };
const LEADERBOARD: NavItem = { href: "/leaderboard", label: "Leaderboard", short: "Leaderboard", icon: "leaderboard", group: "People" };
const TROPHIES: NavItem = { href: "/achievements", label: "Trophies", short: "Trophies", icon: "trophies", group: "People" };
const DISTRICT: NavItem = { href: "/district", label: "District", short: "District", icon: "district", group: "Districts", exact: true };
const DISPUTES: NavItem = { href: "/district/disputes", label: "Disputes", short: "Disputes", icon: "disputes", group: "Districts" };
const SETTINGS: NavItem = { href: "/settings", label: "Settings", short: "Settings", icon: "settings", group: "Workspace" };
const USERS: NavItem = { href: "/settings/users", label: "Users", short: "Users", icon: "users", group: "Workspace" };

// Staff performance is for admins and district managers only.
const STAFF_PERFORMANCE_ROLES = ["super_admin", "dm"];

export default async function Shell({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUser();
  const role = ctx?.profile?.role ?? "lm";
  const isSuperAdmin = role === "super_admin";

  // Super admins get every page. District and operations managers add Users;
  // staff performance is for admins and district managers.
  const items: NavItem[] = [
    DASHBOARD, LIVE, REGISTRATIONS, REFERRALS, DISCOUNTS, AMBASSADORS, ...(isSuperAdmin ? [AMBASSADORS_V2] : []), FORFEIT, CHECK_INS, DROP_INS, EVENTS, WAITLIST, CITIES,
    ...((CITY_LAUNCHER_ROLES as readonly string[]).includes(role) ? [LAUNCHERS] : []),
    ...(STAFF_PERFORMANCE_ROLES.includes(role) ? [STAFF] : []),
    ...(isSuperAdmin ? [MY_DAY, LEADERBOARD, TROPHIES, DISTRICT, DISPUTES] : []),
    ...(isSuperAdmin ? [SETTINGS] : canManageUsers(role) ? [USERS] : []),
  ];
  // A phone gets five tabs and one of them is you, so four sections; the
  // rest are in the You menu.
  const tabItems = [DASHBOARD, REGISTRATIONS, REFERRALS, DISCOUNTS];

  const [jar, theme] = await Promise.all([cookies(), getTheme()]);
  const saved = jar.get(SIDEBAR_COOKIE)?.value;
  const sidebarMode: SidebarMode = saved === "expanded" ? "pinned" : saved === "collapsed" ? "rail" : "auto";

  const user = {
    name: ctx?.profile?.full_name ?? ctx?.user?.email ?? "Signed in",
    email: ctx?.user?.email ?? "",
    role,
  };

  return (
    <AppShell items={items} tabItems={tabItems} user={user} theme={theme} sidebarMode={sidebarMode}>
      {children}
    </AppShell>
  );
}
