"use client";

import records from "../../records/records.module.css";
import { MyWeek } from "./my-week";

/**
 * "My shifts", as the handoff draws it: one screen, the week's schedule
 * with today selected, the chosen ticket beside it, the team and the
 * requests. On the wash like the admin pages — the handoff is light, and
 * this page is read on the office tablet as much as on the floor.
 */
export function MyShifts() {
  return (
    <div className={records.page}>
      <MyWeek />
    </div>
  );
}
