import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { getCanonicalLocations } from "@/lib/districts-locations";

// Locations for the user-assignment picker, from the same canonical list the
// dashboard filter uses, so an assigned location matches the dashboard by name.
export { LOCATIONS_FALLBACK } from "@/lib/districts-locations";

export async function getAssignableLocations(): Promise<string[]> {
  return getCanonicalLocations();
}

export const SEASONS_FALLBACK = ["Fall '26", "Summer '26"];

// Registration seasons from the Promo Tracker (current first), for filters.
export async function getRegistrationSeasons(): Promise<string[]> {
  if (sourceConfigured("promo")) {
    const promo = sourceClient("promo")!;
    const { data } = await promo.from("seasons").select("name, is_current").order("is_current", { ascending: false });
    const names = ((data ?? []) as { name: string | null }[])
      .map((s) => s.name)
      .filter((n): n is string => !!n);
    if (names.length) return names;
  }
  return SEASONS_FALLBACK;
}
