// Pieces the Events page and its tables share, safe on the server and in the
// browser alike.

export const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");

// Under a check-in count: the people going who haven't been checked in, how
// many of those in were new to Brodie (as Going shows for its count), and
// anyone checked in without an RSVP. A person is in or not, so the count above
// already says how many are; this says who is missing and who they were.
export function CheckinNote({ going, checkedInGoing, checkedIn, checkedInNew }: {
  going: number; checkedInGoing: number; checkedIn: number;
  // Absent from an older feed.
  checkedInNew?: number;
}) {
  const missing = Math.max(going - checkedInGoing, 0);
  const walkIns = Math.max(checkedIn - checkedInGoing, 0);
  return (
    <>
      <span className="block">{missing ? `${missing.toLocaleString()} going not checked in` : "everyone going is in"}</span>
      {checkedInNew !== undefined && (
        <span className="block" style={{ color: checkedInNew ? "var(--glass-text-secondary)" : undefined }}>
          {checkedInNew.toLocaleString()} new to Brodie
        </span>
      )}
      {walkIns > 0 && <span className="block">{walkIns.toLocaleString()} without an RSVP</span>}
    </>
  );
}
