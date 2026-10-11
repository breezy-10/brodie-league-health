import EventsView from "./EventsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Events tab: open runs, Kicks of the Week, opening nights and the rest, with
// who's going, who was new, and who went on to register.
export default function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; when?: string }>;
}) {
  return <EventsView searchParams={searchParams} />;
}
