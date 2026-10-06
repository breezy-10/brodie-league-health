"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient } from "@/lib/source-apps/clients";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate one staff member 0 to 10. Each rating is a new row, so the history of
// who rated whom stays; the page reads the latest. requireRole is the gate —
// the table has no policies and is written with the service role.
export async function rateStaff(input: {
  trainingUserId: string;
  rating: number;
}): Promise<{ ok: true; ratedBy: string; ratedAt: string } | { error: string }> {
  const { user, profile } = await requireRole(["super_admin", "dm"]);
  const { trainingUserId, rating } = input;
  if (!UUID_RE.test(trainingUserId)) return { error: "Unknown staff member." };
  if (!Number.isInteger(rating) || rating < 0 || rating > 10) return { error: "A rating is a whole number from 0 to 10." };

  // The person must exist in Training; their email is stored with the rating.
  const training = sourceClient("training");
  if (!training) return { error: "The Training app isn't connected." };
  const { data: person } = await training.from("users").select("email").eq("id", trainingUserId).maybeSingle();
  if (!person) return { error: "That person isn't in the Training app." };

  const ratedBy = profile?.full_name || profile?.email || user.email || "Unknown";
  const { data, error } = await createAdminClient()
    .from("staff_ratings")
    .insert({
      training_user_id: trainingUserId,
      staff_email: (person as { email: string }).email,
      rating,
      rated_by: user.id,
      rated_by_name: ratedBy,
    })
    .select("created_at")
    .single();
  if (error) return { error: "That rating didn't save. Try again." };

  revalidatePath("/staff-performance");
  return { ok: true, ratedBy, ratedAt: (data as { created_at: string }).created_at };
}
