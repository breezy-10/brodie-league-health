"use client";

import { useEffect } from "react";

// Every table's header row stays under the kit's header while the page
// scrolls, and a totals row (a <tfoot>) stays at the bottom of the window, at
// every screen width and on every table, new ones included. CSS sticky can't
// do it alone: a table wide enough to scroll sideways sits in a box that
// scrolls, and a sticky header sticks to that box instead of the window. So
// the cells are moved here, by how far the table has gone past the line, which
// works inside any box. globals.css gives moved cells their frozen look.
//
// A table opts out with data-freeze="off". One with a bar of its own pinned
// above its header (a card's title row) gives that bar's height in
// data-freeze-offset, and the header sits under the bar.
type Tracked = { el: HTMLTableElement; boxes: HTMLElement[]; head: number; foot: number };

export default function FrozenTables() {
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    let tables: Tracked[] = [];
    let dirty = true;
    let frame = 0;

    // The tables on the page, each with the boxes around it that could scroll
    // up and down (a sideways box counts too; whether it really scrolls up and
    // down is checked on every frame).
    const scan = () => {
      const prev = new Map(tables.map((t) => [t.el, t]));
      tables = [...main.querySelectorAll("table")]
        .filter((el) => el.dataset.freeze !== "off" && (el.tHead || el.tFoot))
        .map((el) => {
          const boxes: HTMLElement[] = [];
          for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(p).overflowY)) boxes.push(p);
          }
          return { el, boxes, head: prev.get(el)?.head ?? 0, foot: prev.get(el)?.foot ?? 0 };
        });
      dirty = false;
    };

    const update = () => {
      frame = 0;
      if (dirty) scan();
      const shellTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--shell-top")) || 0;
      // On a phone the tab bar covers the bottom of the window while it shows.
      const bar = document.querySelector(".br-tabbar")?.getBoundingClientRect();
      const floor = bar && bar.height && bar.top < window.innerHeight ? bar.top : window.innerHeight;

      // Read every table first and write after, so the page lays out once.
      const moves = tables.map(({ el, boxes }) => {
        let top = shellTop + (Number(el.dataset.freezeOffset) || 0);
        let bottom = floor;
        for (const b of boxes) {
          if (b.scrollHeight <= b.clientHeight + 1) continue;
          const r = b.getBoundingClientRect();
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
        const t = el.getBoundingClientRect();
        const h = el.tHead?.getBoundingClientRect();
        const f = el.tFoot?.getBoundingClientRect();
        const hasHead = !!h && h.height > 0, hasFoot = !!f && f.height > 0;
        // The header moves down as far as the totals row (or the table's end);
        // the totals row moves up as far as the header.
        const head = hasHead ? Math.round(Math.min(Math.max(0, top - h.top), Math.max(0, (hasFoot ? f.top : t.bottom) - h.bottom))) : 0;
        const foot = hasFoot ? Math.round(Math.max(Math.min(0, bottom - f.bottom), Math.min(0, (hasHead ? h.bottom : t.top) - f.top))) : 0;
        return { head, foot };
      });
      moves.forEach(({ head, foot }, i) => {
        const t = tables[i];
        if (head !== t.head) {
          t.head = head;
          t.el.style.setProperty("--freeze-head", `${head}px`);
          t.el.toggleAttribute("data-frozen-head", head > 0);
        }
        if (foot !== t.foot) {
          t.foot = foot;
          t.el.style.setProperty("--freeze-foot", `${foot}px`);
          t.el.toggleAttribute("data-frozen-foot", foot < 0);
        }
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const rescan = () => {
      dirty = true;
      schedule();
    };

    // Capture catches scrolling inside boxes as well as the window's.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", rescan);
    // Tables come and go as pages and sections load, and rows open and close.
    const mo = new MutationObserver(rescan);
    mo.observe(main, { childList: true, subtree: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(main);
    rescan();

    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", rescan);
      mo.disconnect();
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
