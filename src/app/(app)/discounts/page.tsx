import DiscountsView from "./DiscountsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Discounts tab — the price bridge (list → discount → fees → total price) for the
// registration season, per location, plus the same bridge across seasons.
export default function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  return <DiscountsView searchParams={searchParams} />;
}
