import { InkStock } from "../ink-stock";
import styles from "../../../records/records.module.css";

/** The page with the "New colour" dialog open. */
export default function NewInkPage() {
  return (
    <div className={styles.page}>
      <InkStock openNew />
    </div>
  );
}
