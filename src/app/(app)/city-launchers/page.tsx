import CityLaunchersView from "./CityLaunchersView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// City launchers tab: what each launcher's market registrations cost, and the
// launcher's credit for their own code.
export default function CityLaunchersPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string }>;
}) {
  return <CityLaunchersView searchParams={searchParams} />;
}
