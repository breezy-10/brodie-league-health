import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<{ lm?: string }>;
}) {
  const ctx = await requireUser();
  const sb = await createClient();
  const { lm: viewAsId } = await searchParams;
  const isAdmin = ctx.profile?.role === "dm" || ctx.profile?.role === "super_admin";
  const viewingAs = isAdmin && !!viewAsId;

  let lm: { id: string; full_name: string } | null = null;
  if (viewingAs) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("league_managers")
      .select("id, full_name")
      .eq("id", viewAsId)
      .maybeSingle();
    lm = (data ?? null) as { id: string; full_name: string } | null;
  } else {
    const { data } = await sb
      .from("league_managers")
      .select("id, full_name")
      .eq("email", (ctx.user.email ?? "").toLowerCase())
      .maybeSingle();
    lm = (data ?? null) as { id: string; full_name: string } | null;
  }

  const { data: all } = await sb
    .from("achievements")
    .select("id, slug, name, description, icon, weight")
    .order("weight", { ascending: true });

  const unlockedIds = new Set<string>();
  const unlockedDates = new Map<string, string>();
  if (lm) {
    const { data: mine } = await sb
      .from("lm_achievements")
      .select("achievement_id, unlocked_at")
      .eq("lm_id", lm.id);
    for (const r of (mine ?? []) as Array<{ achievement_id: string; unlocked_at: string }>) {
      unlockedIds.add(r.achievement_id);
      unlockedDates.set(r.achievement_id, r.unlocked_at);
    }
  }

  const achievements = ((all ?? []) as Array<{ id: string; slug: string; name: string; description: string; icon: string }>);
  const unlockedCount = achievements.filter((a) => unlockedIds.has(a.id)).length;

  // We use the training-app PNG badges. Pull mapping per slug.
  const { iconForSlug } = await import("@/lib/badge-icons");

  return (
    <main className="space-y-6">
      {viewingAs && lm && (
        <div className="rounded-2xl border border-glass-gold/40 bg-glass-gold/10 p-3 flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-glass-gold font-semibold px-2 py-1 rounded bg-glass-surface-hover">Viewing as</span>
          <span className="font-semibold">{lm.full_name}</span>
          <a href={`/?lm=${lm.id}`} className="text-xs px-3 py-1.5 rounded-md border border-glass-border bg-[var(--input-bg)] hover:bg-glass-surface-hover transition ml-auto">Their day →</a>
        </div>
      )}

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {viewingAs ? `${lm?.full_name}'s trophies` : "Trophy cabinet"}
        </h1>
        <p className="text-glass-text-secondary text-sm mt-1">
          {unlockedCount} of {achievements.length} unlocked.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {achievements.map((a) => {
          const unlocked = unlockedIds.has(a.id);
          const when = unlockedDates.get(a.id);
          const iconSrc = iconForSlug(a.slug);
          return (
            <div
              key={a.id}
              className={`rounded-2xl border p-4 flex gap-3 transition`}
              style={{
                borderColor: unlocked ? "rgba(242, 169, 0, 0.5)" : "var(--border)",
                background: unlocked ? "var(--accent-soft)" : "var(--bg-raised)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconSrc}
                alt={a.name}
                width={56}
                height={56}
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "contain",
                  filter: unlocked ? "none" : "grayscale(1)",
                  opacity: unlocked ? 1 : 0.4,
                  flexShrink: 0,
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: unlocked ? "var(--text)" : "var(--text-mute)" }}>
                  {a.name}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>{a.description}</p>
                {unlocked && when && (
                  <p className="text-[10px] uppercase tracking-wider font-semibold mt-2" style={{ color: "var(--accent)" }}>
                    Unlocked {new Date(when).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
