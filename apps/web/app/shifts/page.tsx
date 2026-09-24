import { Suspense } from "react";
import { ShiftPlanner } from "./shift-planner";
import styles from "../records/records.module.css";

/**
 * The header lives inside the planner rather than here: its actions (open,
 * copy, clear, publish) act on the week the client component has loaded.
 * The Suspense boundary is what `useSearchParams` needs to read `?week=`.
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
