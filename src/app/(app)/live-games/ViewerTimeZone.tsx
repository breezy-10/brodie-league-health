"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const VIEWER_TZ_COOKIE = "lh_tz";

// Tells the server the viewer's time zone, so the page can default to their
// own date. Written once (and again only if it changes, say after travel),
// then the page re-reads itself with it.
export default function ViewerTimeZone({ current }: { current: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return; }
    if (!tz || tz === current) return;
    document.cookie = `${VIEWER_TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [current, router]);
  return null;
}
