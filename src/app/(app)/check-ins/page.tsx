import CheckInsView from "./CheckInsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Check-ins tab: who the front table checked in each game night and event.
export default function CheckInsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; by?: string }>;
}) {
  return <CheckInsView searchParams={searchParams} />;
}
