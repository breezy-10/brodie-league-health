/**
 * Every row a query matches, not just the first 1,000.
 *
 * Supabase returns at most 1,000 rows per select and says nothing when it
 * stops there. Order the query by a unique key so pages don't overlap or skip.
 * Throws on an error rather than handing back a partial list.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}
