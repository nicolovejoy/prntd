import { permanentRedirect } from "next/navigation";
import { pathWithSearch } from "@/lib/redirect-path";

/**
 * /studio/archive was its own list of closed conversations (studio-plan
 * slice 4). Dropped 2026-09-09 as redundant: My Designs' Active/All filter
 * (#238) already shows every archived image, and the image detail page's
 * "Open conversation" already reopens a closed thread. Archiving itself is
 * unchanged — see src/lib/archive-conversations.ts and
 * src/app/design/actions.ts's reopenConversation.
 *
 * A permanent (308) redirect to /designs (nav model A, 2026-09-27), carrying
 * the query string: this route is gone for good, not moved temporarily, so
 * anything that bookmarked or linked here should update.
 */
export default async function StudioArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  permanentRedirect(pathWithSearch("/designs", await searchParams));
}
