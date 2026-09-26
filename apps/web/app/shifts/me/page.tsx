import { Suspense } from "react";
import { MyShifts } from "./my-shifts";

/**
 * The worker's surface: the running shift and their week. The page wrapper
 * lives in the client component because the whole screen carries
 * `data-surface="floor"`, the same as the handheld's scan page.
 *
 * `useSearchParams` reads `?week=`; the Suspense boundary around it is the
 * docs' recommendation for prerendered routes. This one is dynamic (the root
 * layout awaits `cookies()`), so it never suspends — harmless, and kept for
 * the day a route opts into static rendering.
 */
export default function MyShiftsPage() {
  return (
    <Suspense>
      <MyShifts />
    </Suspense>
  );
}
