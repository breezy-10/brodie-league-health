"use client";

import { useLinkStatus } from "next/link";

/**
 * A progress bar for the navigation the surrounding <Link> has started.
 *
 * The Dashboard renders on the server and waits on a dozen source apps, so a
 * click sits there with nothing happening for a second or two and reads as an
 * unresponsive button. useLinkStatus reports that link's own pending state, so
 * this only has to be a child of the Link — no router events, no context, and
 * it clears itself when the navigation lands or is cancelled.
 *
 * The bar is fixed to the bottom edge of the nav rather than drawn inside the
 * link, so it reads as "the page is loading" instead of decorating one tab.
 */
export function RouteProgressBar({ top = 56 }: { top?: number }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      className="route-progress"
      style={{ position: "fixed", left: 0, right: 0, top, height: 2, zIndex: 40, overflow: "hidden" }}
    >
      <span
        style={{
          display: "block", height: "100%", width: "40%",
          background: "var(--glass-gold)",
          // Indeterminate: there is no progress to report, only that work is
          // happening, so it sweeps rather than filling.
          animation: "route-progress-sweep 1.1s ease-in-out infinite",
        }}
      />
    </span>
  );
}
