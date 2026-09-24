import { ProductionViews } from "./production-views";
import styles from "../records/records.module.css";

/**
 * The header lives inside the client view switcher rather than here: its
 * "Record entry" action opens a form that sits below the toolbar, and the
 * two must share state.
 */
export default function ProductionPage() {
  return (
    <div className={styles.page}>
      <ProductionViews />
    </div>
  );
}
