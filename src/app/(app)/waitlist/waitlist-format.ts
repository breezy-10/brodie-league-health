// Formatting the Waitlist page and its table share, safe on the server and in
// the browser alike.

// Every amount names its currency ("$50.00 USD", "$50.00 CAD"): the markets mix both.
export const money = (n: number, cur: string) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
export const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");
