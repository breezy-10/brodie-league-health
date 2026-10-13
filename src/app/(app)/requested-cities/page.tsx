import RequestedCitiesView from "./RequestedCitiesView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Requested cities: where people have asked Brodie to open, from the
// website's request-a-city form.
export default function RequestedCitiesPage() {
  return <RequestedCitiesView />;
}
