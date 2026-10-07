"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Award,
  BadgePercent,
  CalendarCheck,
  ClipboardList,
  Gift,
  LayoutDashboard,
  Map,
  Scale,
  Settings,
  Star,
  Ticket,
  Trophy,
  UserCheck,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import NavProgress from "@/components/NavProgress";
import { ThemeToggle } from "@/components/ThemeToggle";
import { createClient } from "@/lib/supabase/client";
import { SIDEBAR_COOKIE, type Theme } from "@/lib/theme-shared";

// The Brodie Design Library shell (.br-shell / .br-sidebar / .br-header /
// .br-tabbar), the same as Feedback's and Overdue Payments'. The kit's
// bundle.js wires this behaviour onto static markup; here React owns the state
// instead, because bundle.js toggling classes would be undone by the next render.

export type NavIcon =
  | "dashboard" | "registrations" | "referrals" | "discounts" | "ambassadors" | "dropins" | "staff"
  | "myday" | "leaderboard" | "trophies" | "district" | "disputes" | "settings" | "users";

export interface NavItem {
  href: string;
  label: string;
  // The tab bar's label; it holds five across a phone.
  short: string;
  icon: NavIcon;
  group: string;
  // Only this exact path lights the item (District, not its Disputes page).
  exact?: boolean;
}

export interface ShellUser {
  name: string;
  email: string;
  role: string;
}

export type SidebarMode = "pinned" | "rail" | "auto";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  registrations: ClipboardList,
  referrals: Gift,
  discounts: BadgePercent,
  ambassadors: Star,
  dropins: Ticket,
  staff: UserCheck,
  myday: CalendarCheck,
  leaderboard: Trophy,
  trophies: Award,
  district: Map,
  disputes: Scale,
  settings: Settings,
  users: UserCog,
};

// The page name and the one sentence each page answers (kit Header). More
// specific paths come first. Pages keep a line of their own only for what
// changes with the view: a person's name, the scope, how fresh the data is.
const PAGES: { path: string; exact?: boolean; title: string; subtitle: string }[] = [
  { path: "/dashboard", title: "Dashboard", subtitle: "How every league is tracking this season, across every app." },
  { path: "/weekly-review", title: "Weekly review", subtitle: "Each league's week, Saturday to Friday, beside the season so far." },
  { path: "/registrations/location", title: "By day of week", subtitle: "Each night's teams and athletes at one location, against last season and last year." },
  { path: "/registrations", title: "Registrations", subtitle: "Teams and athletes registered by this day, against last season and last year." },
  { path: "/referrals", title: "Referrals", subtitle: "Who brought players in, and what each referral earned and cost." },
  { path: "/discounts/players", title: "Discounted registrations", subtitle: "Every registration that came with a discount, and what it took off." },
  { path: "/discounts", title: "Price and discounting", subtitle: "What a registration is advertised at, what comes off, and what actually lands." },
  { path: "/ambassador-teams/captain", title: "Captain", subtitle: "One captain's ambassador team and roster." },
  { path: "/ambassador-teams", title: "Ambassador teams", subtitle: "Every night's ambassador team, and how full each roster is." },
  { path: "/drop-ins", title: "Drop-ins", subtitle: "Players who paid for a single game: how many, what they paid, and what came off." },
  { path: "/staff-performance", title: "Staff performance", subtitle: "Everyone in the Training app, with their role and locations, rated from 0 to 10." },
  { path: "/my-day", title: "My day", subtitle: "Today's score and the actions that move it." },
  { path: "/leaderboard", title: "Leaderboard", subtitle: "How league managers rank on XP." },
  { path: "/achievements", title: "Trophies", subtitle: "The trophies unlocked so far, and what's left to earn." },
  { path: "/district/disputes", title: "Disputes", subtitle: "Metrics league managers think are wrong. You decide if the score changes." },
  { path: "/district/prep", title: "One-on-one prep", subtitle: "One league manager's snapshot before your one-on-one." },
  { path: "/district", exact: true, title: "District", subtitle: "Your league managers, ranked by today's XP. Open one to prepare a one-on-one." },
  { path: "/settings/users", title: "Users", subtitle: "Who can use League Health, their role, and the locations they see." },
  { path: "/settings/lms", title: "League managers", subtitle: "Every league manager's score today, ranked, with the change from yesterday." },
  { path: "/settings/lm", title: "League manager", subtitle: "One league manager's score, history and month." },
  { path: "/settings/weights", title: "Weights", subtitle: "How much each app and metric counts. Each set balances to 100." },
  { path: "/settings/setup", title: "Setup doctor", subtitle: "Whether every env var and adapter is wired. Fix anything red before the first cron." },
  { path: "/settings/audit-log", title: "Audit log", subtitle: "Every change, newest first." },
  { path: "/settings/sync", title: "Sync and refresh", subtitle: "Re-run every adapter and re-score everyone, then review the last runs." },
  { path: "/settings", title: "Settings", subtitle: "Scores, roster, weights, syncs and the audit trail." },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Admin",
  dm: "District manager",
  operations_manager: "Operations manager",
  lm: "League manager",
};

// The official B (BrandMark): black, sized by height, never recoloured.
const BRODIE_MARK =
  "https://cdn.prod.website-files.com/6921d2c2bd3b56136200df40/6921d2c2bd3b56136200e036_Brodie_Icon.svg";

// The kit's "auto" sidebar: pinned open at 1100px and wider for anyone who
// has not chosen, a rail below that.
const AUTO_PIN_MIN_WIDTH = 1100;

// Whether the window is narrower than the auto-pin width. The server cannot
// know, so it renders pinned and the client corrects it on hydration.
function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const isNarrow = () => window.innerWidth < AUTO_PIN_MIN_WIDTH;
const isNarrowOnServer = () => false;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();
}

function isActive(pathname: string, item: { href: string; exact?: boolean }) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

function pageFor(pathname: string): { title: string; subtitle?: string } {
  const page = PAGES.find((p) => isActive(pathname, { href: p.path, exact: p.exact }));
  return page ?? { title: "League Health" };
}

// Closes on an outside click or Escape, like the kit's data-br-menu.
function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".br-menu, [data-acct-trigger]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}

function SignOutRow() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      className="is-danger"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        window.location.href = "/login";
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

function TabBar({ items, user, youOpen, onYou }: { items: NavItem[]; user: ShellUser; youOpen: boolean; onYou: () => void }) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);

  // Slides away while you scroll down past 40px and returns on any scroll up
  // (Brodie.tabbar).
  useEffect(() => {
    last.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last.current) < 6) return;
      setHidden(y > last.current && y > 40);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`br-tabbar${hidden && !youOpen ? " is-hidden" : ""}`} aria-label="Sections">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item) && !youOpen;
        return (
          <Link key={item.href} href={item.href} className={active ? "is-on" : undefined} aria-current={active ? "page" : undefined}>
            <Icon strokeWidth={1.6} aria-hidden />
            <span>{item.short}</span>
          </Link>
        );
      })}
      {/* One tab is you: the account, and the rest of the app, live here on a phone. */}
      <button
        type="button"
        className={youOpen ? "is-on" : undefined}
        data-acct-trigger
        onClick={onYou}
        aria-haspopup="menu"
        aria-expanded={youOpen}
      >
        <span className="br-avatar" aria-hidden>{initials(user.name)}</span>
        <span>You</span>
      </button>
    </nav>
  );
}

export default function AppShell({
  items,
  tabItems,
  user,
  theme: initialTheme,
  sidebarMode,
  children,
}: {
  items: NavItem[];
  tabItems: NavItem[];
  user: ShellUser;
  theme: Theme;
  sidebarMode: SidebarMode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // A person's own choice wins; until they make one, "auto" pins the sidebar
  // on wide windows and leaves narrow ones a rail.
  const [choice, setChoice] = useState<boolean | null>(sidebarMode === "auto" ? null : sidebarMode === "pinned");
  const narrow = useSyncExternalStore(subscribeResize, isNarrow, isNarrowOnServer);
  const pinned = choice ?? !narrow;
  const [floating, setFloating] = useState(false);
  const [menu, setMenu] = useState<"side" | "phone" | null>(null);
  // Navigating closes any open menu (state adjusted during render, not in an
  // effect, so there is no extra paint with the menu still up).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenu(null);
  }
  const hold = useRef(false);
  const hovering = useRef(false);
  const canHover = useRef(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    canHover.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);

  // The header grows when its subtitle wraps; anything sticky under it reads
  // its real height from --shell-top.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--shell-top", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pathname]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    if (!hovering.current) setFloating(false);
  }, []);
  useDismiss(menu !== null, closeMenu);

  function toggleSidebar() {
    const next = !pinned;
    setChoice(next);
    setFloating(false);
    // Collapsing from under the pointer would otherwise reopen it at once:
    // stay a rail until the pointer leaves.
    hold.current = !next;
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }

  const page = pageFor(pathname);
  const rail = !pinned && !floating;
  // On a phone the tab bar holds four sections; the rest of the app is reached
  // from the You menu so nothing becomes unreachable.
  const overflow = items.filter((i) => !tabItems.includes(i));
  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  // A sentence-case heading wherever the group changes (kit Sidebar).
  const headers = items.map((item, i) => (item.group && item.group !== items[i - 1]?.group ? item.group : null));

  return (
    <div className={`br-shell${pinned ? "" : " is-rail"}`}>
      <aside
        className={`br-sidebar${rail ? " is-rail" : ""}${floating && !pinned ? " is-floating" : ""}`}
        aria-label="League Health"
        onMouseEnter={() => {
          hovering.current = true;
          if (canHover.current && !pinned && !hold.current) setFloating(true);
        }}
        onMouseLeave={() => {
          hovering.current = false;
          hold.current = false;
          // A rail stays open while its menu is open.
          if (menu === "side") return;
          setFloating(false);
        }}
      >
        <div className="br-sb-brand">
          <Link href="/dashboard" aria-label="League Health home" style={{ flex: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="br-sb-logo" src={BRODIE_MARK} alt="Brodie" />
          </Link>
          <span className="br-sb-name">League Health</span>
          <button
            type="button"
            className="br-sb-toggle"
            onClick={toggleSidebar}
            aria-label={pinned ? "Collapse the sidebar" : "Keep the sidebar open"}
            title={pinned ? "Collapse the sidebar" : "Keep the sidebar open"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4.5" width="18" height="15" rx="3.2" />
              <path d="M9.5 4.5v15" />
            </svg>
          </button>
        </div>

        <nav className="br-sb-nav" aria-label="Main">
          {items.map((item, i) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item);
            const header = headers[i];
            return (
              <div key={item.href} style={{ display: "contents" }}>
                {header && <div className="br-sb-header">{header}</div>}
                <Link
                  href={item.href}
                  className={`br-sb-item${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  title={rail ? item.label : undefined}
                >
                  <Icon strokeWidth={1.6} aria-hidden />
                  <span className="br-sb-label">{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="br-sb-foot">
          <button
            type="button"
            className="br-sb-me"
            data-acct-trigger
            onClick={() => setMenu((m) => (m === "side" ? null : "side"))}
            aria-haspopup="menu"
            aria-expanded={menu === "side"}
            title={rail ? user.name : undefined}
          >
            <span className="br-avatar" aria-hidden>{initials(user.name)}</span>
            <span className="br-sb-me-t">
              <b>{user.name}</b>
              <small>{roleLabel}</small>
            </span>
            <svg className="br-sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />
            </svg>
          </button>
          {menu === "side" && (
            <div className="br-menu" role="menu" aria-label="Your account">
              <ThemeToggle theme={theme} onChange={setTheme} />
              <hr />
              <SignOutRow />
            </div>
          )}
        </div>
      </aside>

      <div className="br-main">
        <header ref={headerRef} className="br-header">
          <div className="br-hd-t">
            <Link href="/dashboard" aria-label="League Health home" style={{ flex: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="br-hd-logo" src={BRODIE_MARK} alt="" />
            </Link>
            <div>
              <h1 className="br-hd-title">{page.title}</h1>
              {page.subtitle && <p className="br-hd-sub">{page.subtitle}</p>}
            </div>
          </div>
          <div className="hd-progress">
            <NavProgress />
          </div>
        </header>
        <main className="br-page">{children}</main>
      </div>

      <TabBar items={tabItems} user={user} youOpen={menu === "phone"} onYou={() => setMenu((m) => (m === "phone" ? null : "phone"))} />
      {menu === "phone" && (
        <div className="br-menu is-card is-phone" role="menu" aria-label="Your account">
          <b>{user.name}</b>
          <span>{user.email}</span>
          {overflow.map((item) => (
            <Link key={item.href} href={item.href} role="menuitem" onClick={closeMenu}>
              {item.label}
            </Link>
          ))}
          <ThemeToggle theme={theme} onChange={setTheme} />
          <SignOutRow />
        </div>
      )}
    </div>
  );
}
