import { Suspense } from "react";
import { ProductionViews } from "./production-views";
import styles from "../records/records.module.css";

/**
 * The header lives inside the client view switcher rather than here: its
 * "Record entry" action opens a form that sits below the toolbar, and the
 * two must share state.
 *
 * `useSearchParams` reads `?date=`; the Suspense boundary around it is the
 * docs' recommendation for prerendered routes, as on the shifts pages. This
 * route is dynamic (the root layout awaits `cookies()`), so it never
 * suspends.
 */
export default function ProductionPage() {
  return (
    <div className={styles.page}>
      <Suspense>
        <ProductionViews />
      </Suspense>
    </div>
  );
}
