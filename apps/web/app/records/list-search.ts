/**
 * The search a list page opens with: `?search=`, which the top bar's "See
 * all results" link sets. The page reads it and hands it to its table as the
 * first value of the table's own search; from there the box owns it, and
 * the URL is not kept in step with what is typed.
 *
 * Pages render the table with `key={search}`, so following a second link to
 * a list already on screen starts it over with the new term.
 */
export interface ListPageProps {
  searchParams: Promise<{ search?: string | string[] }>;
}

/** The list inputs cap a search at 200 characters; a longer URL is cut, not refused. */
const SEARCH_MAX = 200;

export async function initialSearchOf(searchParams: ListPageProps["searchParams"]): Promise<string> {
  const { search } = await searchParams;
  const value = Array.isArray(search) ? search[0] : search;
  return value?.trim().slice(0, SEARCH_MAX) ?? "";
}
