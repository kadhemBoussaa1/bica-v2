import { MyShifts } from "./my-shifts";

/**
 * The worker's surface: the running shift and their week. The page wrapper
 * lives in the client component because the whole screen carries
 * `data-surface="floor"`, the same as the handheld's scan page.
 */
export default function MyShiftsPage() {
  return <MyShifts />;
}
