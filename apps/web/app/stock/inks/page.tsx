import { InkStock } from "./ink-stock";
import { initialSearchOf, type ListPageProps } from "../../records/list-search";
import styles from "../../records/records.module.css";

/**
 * The header is part of the client component: its figure tiles and the
 * "New colour" dialog live with the grid (`Ink stock v3.dc.html`).
 */
export default async function InksPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  return (
    <div className={styles.page}>
      <InkStock key={search} initialSearch={search} />
    </div>
  );
}
