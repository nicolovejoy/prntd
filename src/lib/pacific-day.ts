/**
 * Pacific calendar-day math for admin reports. Timestamps are stored in UTC;
 * a "day" shown to a person is a Pacific day (see display-time-zone.ts). SQL
 * filters take the UTC instant a Pacific day starts at, computed here.
 */
import { DISPLAY_TIME_ZONE } from "./display-time-zone";

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const wallClockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** The Pacific calendar day of an instant, as `YYYY-MM-DD`. */
export function pacificDayKey(date: Date): string {
  return dayKeyFormat.format(date);
}

/** Pacific wall-clock time minus UTC at an instant, in ms (negative). */
function pacificOffsetMs(instant: number): number {
  const parts: Record<string, number> = {};
  for (const p of wallClockFormat.formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Drop sub-second noise so the offset is a whole number of seconds.
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant at which the Pacific civil day y-m-d (month 1-12) begins.
 * Out-of-range day numbers roll over like Date.UTC does. Pacific midnight is
 * never inside a DST gap (transitions are at 2 AM), so the fixed-point
 * iteration settles in two passes.
 */
function pacificMidnight(year: number, month: number, day: number): Date {
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    instant = wall - pacificOffsetMs(instant);
  }
  return new Date(instant);
}

function civilParts(date: Date): { year: number; month: number; day: number } {
  const [year, month, day] = pacificDayKey(date).split("-").map(Number);
  return { year, month, day };
}

/** The UTC instant at which the Pacific day containing `date` begins. */
export function pacificDayStart(date: Date): Date {
  const { year, month, day } = civilParts(date);
  return pacificMidnight(year, month, day);
}

/**
 * Lower bounds for the admin usage windows. `todayStart` is the start of the
 * current Pacific day; `weekStart` is the start of the day six days earlier,
 * so "last 7 days" is today plus the six Pacific days before it.
 */
export function pacificWindowStarts(now: Date): {
  todayStart: Date;
  weekStart: Date;
} {
  const { year, month, day } = civilParts(now);
  return {
    todayStart: pacificMidnight(year, month, day),
    weekStart: pacificMidnight(year, month, day - 6),
  };
}
