import type { inferRouterOutputs } from "@trpc/server";
// Type-only import: erased at compile time, so no server code reaches the bundle.
import type { AppRouter } from "api/src/trpc/trpc.router";

/**
 * Row shapes derived from the router rather than hand-written, so a change
 * to a server `select` reaches every component here at typecheck time.
 */
type Outputs = inferRouterOutputs<AppRouter>;

export type WeekData = NonNullable<Outputs["shift"]["weekByStart"]["week"]>;
/** A person's shift for the week. */
export type WeekAssignment = WeekData["assignments"][number];
export type RosterEmployee = WeekAssignment["employee"];
/** One of the week's 18 day-shifts. */
export type ShiftData = WeekData["shifts"][number];
export type DayViewData = Outputs["shift"]["dayView"];
export type DayShift = DayViewData["shifts"][number];
export type TaskData = DayShift["tasks"][number];
export type ChangeRow = Outputs["shift"]["listChanges"]["rows"][number];
export type MyWeekData = Outputs["shift"]["myWeek"];
export type MyWeek = NonNullable<MyWeekData["week"]>;
/** One of the viewer's day-shifts, with their tickets on it. */
export type MyShift = MyWeek["shifts"][number];
export type CurrentData = Outputs["shift"]["current"];
