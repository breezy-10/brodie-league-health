import DashboardView from "./DashboardView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Two views of the same dashboard, chosen by the tabs under the heading:
// the season to date, or one Saturday-Friday week of it. The Weekly review nav
// item still has its own route — this is the same view reachable without
// leaving the dashboard.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string; week?: string; view?: string }>;
}) {
  const { view } = await searchParams;
  return <DashboardView searchParams={searchParams} mode={view === "weekly" ? "weekly" : "full"} showViewTabs />;
}
