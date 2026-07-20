import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";

// Canonical location names for the user-assignment picker. Sourced from the
// Registration Promo Tracker (the same list the dashboard filter uses) so an
// assigned location matches the dashboard by name; falls back to this copy when
// the PROMO_SUPABASE_* connection isn't configured.
export const LOCATIONS_FALLBACK = [
  "Boston", "Brampton", "Brooklyn - Bushwick", "Brooklyn - Greenpoint", "Burlington",
  "Calgary", "Chicago", "Edmonton", "Kitchener", "London", "Markham", "Milton",
  "Mississauga", "Montreal", "Niagara", "Oakville", "Oshawa", "Ottawa", "Scarborough",
  "Toronto (Downtown)", "Toronto (Hoopdome)", "Vancouver", "Vaughan", "Winnipeg",
];

export async function getAssignableLocations(): Promise<string[]> {
  if (sourceConfigured("promo")) {
    const promo = sourceClient("promo")!;
    const { data } = await promo.from("locations").select("name, sort_order").order("sort_order");
    const names = ((data ?? []) as { name: string | null }[])
      .map((l) => l.name)
      .filter((n): n is string => !!n);
    if (names.length) return names;
  }
  return LOCATIONS_FALLBACK;
}
