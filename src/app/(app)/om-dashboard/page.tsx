import DashboardView from "../dashboard/DashboardView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// The operations managers' dashboard: the season view of the DM/LM Dashboard
// with their own Season Success checklist and only the sections they run.
export default async function OmDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string }>;
}) {
  return <DashboardView searchParams={searchParams} mode="om" />;
}
