import LmBonusView from "./LmBonusView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// LM bonus: each league manager's registration bonus this season, by the
// districts app's LM Comp Model V5, bonus only (no base salary, no share of
// collected). League managers see their own; district managers, operations
// managers and super admins see everyone's.
export default function LmBonusPage() {
  return <LmBonusView />;
}
