/**
 * /prints is retired (nav model A, docs/ux-design-review-2026-09.md): the
 * community feed is /shop, and "Shop" now names exactly one thing. 308 so the
 * old links — including every published-design card that carried
 * `?from=/prints` — keep resolving.
 */
import { permanentRedirect } from "next/navigation";

export default function PrintsPage(): never {
  permanentRedirect("/shop");
}
