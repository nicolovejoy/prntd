/**
 * The zone a calendar day is shown in: Pacific time. Repo convention is UTC
 * at rest and Pacific on display, and it applies to every calendar day shown
 * to a person — server components, emails and client components alike, not
 * only the cases below.
 *
 * Server-rendered client components have a second reason to pin it. They
 * print a date twice, once on the server (UTC on Vercel) and again in the
 * browser at hydration (the viewer's zone and locale). Formatted in the
 * process's own zone, the two disagree for any timestamp between 00:00 UTC
 * and the Pacific midnight, and React throws #418. Pass this zone, and an
 * explicit locale, whenever a date is formatted for display — or use
 * formatDisplayDate / formatDisplayDateTime below, which do both.
 */
export const DISPLAY_TIME_ZONE = "America/Los_Angeles";

type DisplayDateInput = Date | string | number;

/** A calendar day in the display zone, e.g. `9/25/2026`. */
export function formatDisplayDate(date: DisplayDateInput): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(date));
}

/**
 * A day and time in the display zone with the short zone name, e.g.
 * `9/25/26, 8:04:05 PM PDT`. The zone name is shown so a reader matching a
 * row against UTC logs doesn't have to guess the offset. Explicit fields are
 * used because `timeZoneName` can't be combined with `dateStyle`/`timeStyle`.
 */
export function formatDisplayDateTime(
  date: DisplayDateInput,
  opts?: { seconds?: boolean },
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(opts?.seconds ? { second: "2-digit" } : {}),
    timeZoneName: "short",
  }).format(new Date(date));
}
