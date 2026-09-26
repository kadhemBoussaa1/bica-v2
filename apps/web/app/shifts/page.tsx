import { Suspense } from "react";
import { ShiftPlanner } from "./shift-planner";
import styles from "../records/records.module.css";

/**
 * The header lives inside the planner rather than here: its actions (open,
 * copy, clear, publish) act on the week the client component has loaded.
 *
 * `useSearchParams` reads `?week=`; the Suspense boundary around it is the
 * docs' recommendation for prerendered routes. This one is dynamic (the root
 * layout awaits `cookies()`), so it never suspends — harmless, and kept for
 * the day a route opts into static rendering.
 */
export default function ShiftsPage() {
  return (
    <div className={styles.page}>
      <Suspense>
        <ShiftPlanner />
      </Suspense>
    </div>
  );
}
