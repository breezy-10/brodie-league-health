import DashboardView from "../dashboard/DashboardView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Weekly Review — the full dashboard plus a Saturday–Friday Week filter.
// Registrations, Stats Health, and Content Health are scoped to the week; the
// other sections show the season to date.
export default function WeeklyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string; week?: string }>;
}) {
  return <DashboardView searchParams={searchParams} mode="weekly" />;
}
