// Placeholders shown while a section's source app is still answering. They
// mirror the real layout — same heading height, same card grid — so the page
// does not jump around as each section arrives.

export function TilePlaceholder() {
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="h-2.5 w-24 rounded skeleton-pulse" />
      <div className="h-7 w-16 mt-2.5 rounded skeleton-pulse" />
      <div className="h-2 w-20 mt-2.5 rounded skeleton-pulse" />
      <div className="h-2 w-28 mt-1.5 rounded skeleton-pulse" />
    </div>
  );
}

export function SectionSkeleton({ title, cols = 4 }: { title: string; cols?: 4 | 6 }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
        <div className="h-2.5 w-20 rounded skeleton-pulse" />
      </div>
      <div className={cols === 6
        ? "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
        : "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}>
        {Array.from({ length: cols }).map((_, i) => <TilePlaceholder key={i} />)}
      </div>
    </section>
  );
}

export function TableSkeleton({ title, rows = 4 }: { title: string; rows?: number }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
      <div className="rounded-2xl border border-glass-border bg-glass-surface p-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-3 rounded skeleton-pulse" style={{ width: `${92 - i * 11}%` }} />
        ))}
      </div>
    </section>
  );
}
