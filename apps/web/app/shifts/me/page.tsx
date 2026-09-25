import { Suspense } from "react";
import { MyShifts } from "./my-shifts";

/**
 * The worker's surface: the running shift and their week. The page wrapper
 * lives in the client component because the whole screen carries
 * `data-surface="floor"`, the same as the handheld's scan page. The
 * Suspense boundary is what `useSearchParams` needs to read `?week=`.
 */
export default function MyShiftsPage() {
  return (
    <Suspense>
      <MyShifts />
    </Suspense>
  );
}
