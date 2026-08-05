import DashboardView from "../dashboard/DashboardView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Registrations tab — the same filters + Registrations section as the dashboard,
// with the other sections hidden (mode="registrations").
export default function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  return <DashboardView searchParams={searchParams} mode="registrations" />;
}
