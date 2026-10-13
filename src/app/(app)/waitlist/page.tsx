import WaitlistView from "./WaitlistView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Waitlist: the markets Brodie is opening next and who put down a deposit to
// be first in.
export default function WaitlistPage() {
  return <WaitlistView />;
}
