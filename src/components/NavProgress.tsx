"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A thin indeterminate bar under the nav, shown from the moment a link or a
// filter form is used until the new page commits. Every screen here is
// force-dynamic, so a menu click waits on the server with no feedback at all.
//
// Driven by document-level clicks rather than useLinkStatus so it covers the
// in-page tab strips and the season/location filters too, not just the top nav.
function Bar() {
  const pathname = usePathname();
  const searchKey = useSearchParams().toString();
  const [loading, setLoading] = useState(false);

  // The route committing IS the end of the load.
  useEffect(() => setLoading(false), [pathname, searchKey]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Modifier clicks open a new tab; this one is not going anywhere.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || anchor.hasAttribute("download")) return;
      if (anchor.getAttribute("target") === "_blank") return;
      let url: URL;
      try {
        url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same URL, or a bare hash: no server round trip to wait for.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setLoading(true);
    };
    // The season / location filters navigate by GET submit.
    const onSubmit = () => setLoading(true);

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  // A cancelled or failed navigation would otherwise leave it running forever.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    // Always occupies its 2px so the page below never shifts when it appears.
    <div
      className="relative h-0.5 shrink-0 overflow-hidden"
      style={{ background: loading ? "var(--glass-border-light)" : "transparent" }}
      role="progressbar"
      aria-hidden={!loading}
      aria-label={loading ? "Loading page" : undefined}
    >
      {loading && <div className="nav-progress-bar" />}
    </div>
  );
}

export default function NavProgress() {
  // useSearchParams needs a boundary for any route that prerenders.
  return (
    <Suspense fallback={<div className="h-0.5 shrink-0" />}>
      <Bar />
    </Suspense>
  );
}
