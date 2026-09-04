import { SectionSkeleton, TableSkeleton } from "./Skeletons";

// Shown the moment the Dashboard is navigated to, so the shell and the section
// headings are on screen while the source apps are still answering.
export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-2.5 w-24 rounded skeleton-pulse" />
        <div className="h-7 w-56 mt-2 rounded skeleton-pulse" />
        <div className="h-3 w-80 mt-2 rounded skeleton-pulse" />
      </div>
      <div className="flex gap-3">
        <div className="h-10 w-40 rounded-lg skeleton-pulse" />
        <div className="h-10 w-48 rounded-lg skeleton-pulse" />
      </div>
      <SectionSkeleton title="Season Success Checklist" cols={6} />
      <SectionSkeleton title="Registrations" />
      <SectionSkeleton title="Registration Promo Tracker" />
      <SectionSkeleton title="Outreach" />
      <TableSkeleton title="Site Visits" />
      <SectionSkeleton title="Training" />
      <SectionSkeleton title="Stats Health" />
      <SectionSkeleton title="Content Health" />
    </div>
  );
}
