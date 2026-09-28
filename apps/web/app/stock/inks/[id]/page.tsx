import { InkStock } from "../ink-stock";
import styles from "../../../records/records.module.css";

/** A colour's own URL — where global search lands: the page, its drawer open. */
export default async function InkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className={styles.page}>
      <InkStock key={id} openId={id} />
    </div>
  );
}
