import { permanentRedirect } from "next/navigation";

/**
 * /studio/archive was its own list of closed conversations (studio-plan
 * slice 4). Dropped 2026-09-09 as redundant: Library's Active/All filter
 * (#238) already shows every archived image, and the image detail page's
 * "Open conversation" already reopens a closed thread. Archiving itself is
 * unchanged — see src/lib/archive-conversations.ts and
 * src/app/design/actions.ts's reopenConversation.
 *
 * A permanent (308) redirect: this route is gone for good, not moved
 * temporarily, so anything that bookmarked or linked here should update.
 */
export default function StudioArchivePage(): never {
  permanentRedirect("/studio/library");
}
