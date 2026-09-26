// Person names compared across systems — ops player profiles against training
// staff profiles — so accents, punctuation and spacing don't decide a match.
export function normName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
