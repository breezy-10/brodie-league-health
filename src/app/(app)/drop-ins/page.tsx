import DropInsView from "./DropInsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Drop-ins tab: players who paid for a single game, per location, with the
// same price bridge as Discounts (list, discount, fees, total price).
export default function DropInsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string }>;
}) {
  return <DropInsView searchParams={searchParams} />;
}
