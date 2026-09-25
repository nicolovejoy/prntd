/**
 * The zone a calendar day is shown in: Pacific time. Repo convention is UTC
 * at rest and Pacific on display.
 *
 * It also keeps hydration intact. A server-rendered client component prints
 * a date twice, once on the server (UTC on Vercel) and again in the browser
 * at hydration (the viewer's zone and locale). Formatted in the process's
 * own zone, the two disagree for any timestamp between 00:00 UTC and the
 * Pacific midnight, and React throws #418. Pass this zone, and an explicit
 * locale, to every date a server-rendered client component prints.
 */
export const DISPLAY_TIME_ZONE = "America/Los_Angeles";
