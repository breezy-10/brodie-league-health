"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-reads the page every minute while it's open and visible, so a game moves
// from upcoming to live to done without a manual refresh.
export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
