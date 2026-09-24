import {
  addDays,
  daysForShiftType,
  isoDayOf,
  plantDay,
  SHIFT_HOURS,
  utcDay,
  weekEndsAt,
  weekStartOf,
  type ShiftType,
} from "@repo/api-contract";
import { dateFormat } from "../../i18n/formats";

/**
 * Display helpers for the shift pages. Nothing here is a new date rule:
 * the day-and-clock formats come from `i18n/formats.ts`, and every date is
 * formatted in UTC because a shift's `date` is a `@db.Date` — UTC midnight —
 * and letting the browser's zone shift it would move Sunday night to
 * Saturday for anyone west of the plant.
 */

/** The Sunday of the week running now, in plant time. */
export function thisWeekStart(): string {
  return weekStartOf(plantDay());
}

export function stepWeek(weekStart: string, weeks: number): string {
  return addDays(weekStart, 7 * weeks);
}

/** The seven days of a week, Sunday first. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset));
}

/**
 * Wraps a left-to-right run — a clock range, a date range — in Unicode
 * isolates, so an Arabic sentence cannot reorder "22:00–06:00" into
 * "06:00–22:00". Characters rather than markup, because these strings also
 * fill `<option>` labels, where a `<bdi>` cannot go.
 */
function ltr(text: string): string {
  return `\u2066${text}\u2069`;
}

/** "27/09/2026 – 03/10/2026". */
export function formatWeekRange(weekStart: string): string {
  const day = dateFormat({ dateStyle: "medium", timeZone: "UTC" });
  return ltr(`${day.format(utcDay(weekStart))} – ${day.format(utcDay(addDays(weekStart, 6)))}`);
}

/** "27/09". */
export function formatDayShort(value: string | Date): string {
  return dateFormat({ day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    utcDay(isoDayOf(value)),
  );
}

/** "27/09/2026". */
export function formatShiftDate(value: string | Date): string {
  return dateFormat({ dateStyle: "medium", timeZone: "UTC" }).format(utcDay(isoDayOf(value)));
}

/** "Sun" — a weekday name is a word, so it follows the reader's language. */
export function formatWeekday(value: string | Date): string {
  return dateFormat({ weekday: "short", timeZone: "UTC" }).format(utcDay(isoDayOf(value)));
}

/** "Sunday". */
export function formatWeekdayLong(value: string | Date): string {
  return dateFormat({ weekday: "long", timeZone: "UTC" }).format(utcDay(isoDayOf(value)));
}

/** "22:00–06:00", from the plant's fixed hours. */
export function formatShiftHours(type: ShiftType): string {
  const { start, end } = SHIFT_HOURS[type];
  const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  return ltr(`${hh(start)}–${hh(end)}`);
}

/** A wall-clock time in plant time, for an absolute instant: "22:00". */
export function formatPlantTime(value: string | Date): string {
  return dateFormat({ hour: "2-digit", minute: "2-digit", timeZone: "Africa/Tunis" }).format(
    new Date(value),
  );
}

/** "Sun 27/09 · Night 22:00–06:00" — how a shift is named in a picker. */
export function shiftLabel(
  shift: { date: string | Date; type: ShiftType },
  typeName: string,
): string {
  return `${formatWeekday(shift.date)} ${formatDayShort(shift.date)} · ${typeName} ${formatShiftHours(shift.type)}`;
}

/**
 * The first and last weekday a shift type covers this week, as words:
 * ["Sunday", "Friday"] for the night shift, ["Monday", "Saturday"] otherwise.
 */
export function shiftDaySpan(weekStart: string, type: ShiftType): [string, string] {
  const days = daysForShiftType(type);
  const first = days[0] ?? 0;
  const last = days[days.length - 1] ?? 6;
  return [formatWeekdayLong(addDays(weekStart, first)), formatWeekdayLong(addDays(weekStart, last))];
}

/** A week is over once its last shift (Saturday afternoon) has ended. */
export function weekIsOver(weekStart: string | Date, now = new Date()): boolean {
  return weekEndsAt(isoDayOf(weekStart)).getTime() <= now.getTime();
}

/** Today's offset in the week (0 = Sunday), or null when the week is not this one. */
export function todayOffsetIn(weekStart: string | Date): number | null {
  const today = plantDay();
  const start = isoDayOf(weekStart);
  if (weekStartOf(today) !== start) return null;
  return Math.round((utcDay(today).getTime() - utcDay(start).getTime()) / 86_400_000);
}

export function hasStarted(shift: { startsAt: string | Date }, now = new Date()): boolean {
  return new Date(shift.startsAt).getTime() <= now.getTime();
}

export function hasEnded(shift: { endsAt: string | Date }, now = new Date()): boolean {
  return new Date(shift.endsAt).getTime() <= now.getTime();
}

export function employeeName(employee: { firstName: string; lastName: string; matricule: string }): string {
  return [employee.lastName, employee.firstName].filter(Boolean).join(" ") || employee.matricule;
}
