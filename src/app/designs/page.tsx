/**
 * /designs is retired (nav model A, docs/ux-design-review-2026-09.md): My
 * Designs is the Studio's Library view. The redirect keeps every bookmark,
 * shared link and `?from=/designs` marker working.
 *
 * permanentRedirect (308) rather than redirect (307) because the move is
 * permanent and we want crawlers and browsers to stop asking.
 *
 * Note src/app/designs/actions.ts stays where it is — a dozen modules import
 * it, and a non-route file inside app/ is just a module.
 */
import { permanentRedirect } from "next/navigation";

export default function DesignsPage(): never {
  permanentRedirect("/studio/library");
}
