import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<{ lm?: string }>;
}) {
  const ctx = await requireRole(["super_admin"]);
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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {achievements.map((a) => {
          const unlocked = unlockedIds.has(a.id);
          const when = unlockedDates.get(a.id);
          const iconSrc = iconForSlug(a.slug);
          return (
            <div
              key={a.id}
              className="rounded-2xl border p-4 sm:p-5 flex flex-col items-center text-center transition"
              style={{
                borderColor: unlocked ? "rgba(242, 169, 0, 0.5)" : "var(--border)",
                background: unlocked ? "var(--accent-soft)" : "var(--bg-raised)",
                boxShadow: unlocked ? "0 6px 20px rgba(242, 169, 0, 0.15)" : "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconSrc}
                alt={a.name}
                width={140}
                height={140}
                style={{
                  width: "100%",
                  maxWidth: 140,
                  height: "auto",
                  aspectRatio: "1 / 1",
                  objectFit: "contain",
                  filter: unlocked ? "drop-shadow(0 4px 12px rgba(242, 169, 0, 0.35))" : "grayscale(1)",
                  opacity: unlocked ? 1 : 0.35,
                }}
              />
              <p
                className="text-sm sm:text-base font-semibold mt-3"
                style={{ color: unlocked ? "var(--text)" : "var(--text-mute)" }}
              >
                {a.name}
              </p>
              <p
                className="text-[11px] sm:text-xs mt-1 leading-snug"
                style={{ color: "var(--text-mute)" }}
              >
                {a.description}
              </p>
              {unlocked && when && (
                <p
                  className="text-[10px] uppercase tracking-wider font-semibold mt-3 px-2 py-1 rounded-full"
                  style={{
                    color: "var(--accent)",
                    background: "var(--bg-raised)",
                    border: "1px solid rgba(242, 169, 0, 0.4)",
                  }}
                >
                  Unlocked {new Date(when).toLocaleDateString()}
                </p>
              )}
              {!unlocked && (
                <p
                  className="text-[10px] uppercase tracking-wider font-semibold mt-3 px-2 py-1 rounded-full"
                  style={{
                    color: "var(--text-mute)",
                    background: "var(--bg-sunken)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Locked
                </p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
