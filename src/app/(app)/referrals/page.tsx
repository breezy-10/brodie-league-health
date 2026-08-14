import ReferralsView from "./ReferralsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Referrals tab — per-location referral counts for the registration season,
// using the same Season / Location / League manager filters as the other tabs.
export default function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  return <ReferralsView searchParams={searchParams} />;
}
