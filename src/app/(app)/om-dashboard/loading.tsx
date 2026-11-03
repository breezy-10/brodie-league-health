import { SectionSkeleton, TableSkeleton } from "../dashboard/Skeletons";

// Shown the moment the OM Dashboard is navigated to, with its own sections.
export default function OmDashboardLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-3 w-80 rounded skeleton-pulse" />
      </div>
      <div className="flex gap-3">
        <div className="h-10 w-40 rounded-lg skeleton-pulse" />
        <div className="h-10 w-48 rounded-lg skeleton-pulse" />
      </div>
      <SectionSkeleton title="Season Success Checklist" cols={6} />
      <SectionSkeleton title="Registrations" />
      <SectionSkeleton title="Drop-ins" />
      <SectionSkeleton title="Events" />
      <SectionSkeleton title="Check-ins" />
      <SectionSkeleton title="Stats Health" />
      <SectionSkeleton title="Content Health" />
      <SectionSkeleton title="Feedback" />
      <SectionSkeleton title="Overdue Payments" />
      <TableSkeleton title="Facility Bookings" rows={6} />
      <SectionSkeleton title="Facility Payments" />
      <TableSkeleton title="Referee Bookings" rows={6} />
      <SectionSkeleton title="Referee Payments" />
    </div>
  );
}
