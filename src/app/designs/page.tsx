import Link from "next/link";
import { requireStudioUser } from "@/lib/require-user";
import { getUserImageLibrary } from "@/lib/user-designs";
import { Button, EmptyState } from "@/components/ui";
import {
  EXPORT_PART_MAX_IMAGES,
  summarizeExportParts,
} from "@/lib/design-export";
import { ExportControl } from "./export-link";
import { LibraryGrid } from "./library-grid";
import { GuestKeepLine } from "../studio/guest-keep-line";

/**
 * My Designs: every image this user has made. A top-level destination in the
 * header since 2026-09-27 ("it's hard to find my designs" — Nico), no longer
 * a tab inside the Studio; /studio/library and /studio/archive 308 here
 * (docs/superpowers/plans/2026-09-27-my-designs-nav.md).
 *
 * Same gate as the Studio bench (requireStudioUser): a real account, or a
 * guest-funnel session while GUEST_FUNNEL_ENABLED is on (#241). A visitor
 * with no session cookie never gets here — the proxy sends them to
 * /sign-in.
 *
 * A server component. The grid (LibraryGrid) is the client island: tiles are
 * links, plus the Active/All filter and select mode for bulk delete (#195,
 * #238). Per-image actions live one tap deeper, on the image detail page.
 *
 * With at least one image, the masthead row has "Download all my designs"
 * (#12): a zip of every owned image from /designs/export, in parts of up to
 * 50 images, oldest first, without admin-hidden ones (#288). One part is a
 * plain link; several open a panel with one link per part. The part summaries
 * come from the library this page already loads, minus its hidden images,
 * reversed to the export's oldest-first order (a real-DB test pins that the
 * two are exact reverses), so nothing extra is fetched.
 *
 * Guests (#241) get their own images and, once there is at least one, the
 * sign-up/sign-in line. An empty library shows only its empty state: "keep
 * these designs" beside "No designs yet." reads wrong.
 */
export default async function DesignsPage() {
  const { session, isGuest } = await requireStudioUser("/designs");
  const images = await getUserImageLibrary(session.user.id);
  // The export leaves out admin-hidden images (loadExportRows does the same in
  // SQL), so the parts and the count come from the visible ones only.
  const exportable = images.filter((i) => !i.isHidden);
  const exportParts = summarizeExportParts([...exportable].reverse()).map((p) => ({
    ...p,
    firstCreatedAt: p.firstCreatedAt.toISOString(),
    lastCreatedAt: p.lastCreatedAt.toISOString(),
  }));

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
        <div className="mb-6 flex items-center justify-between gap-3">
          {/* Mono masthead, same type classes as /orders and /shop use (/shop
              adds its own margin), so this row is 16 px tall like theirs. */}
          <h1 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            My Designs
          </h1>
          {exportable.length > 0 && (
            // The control is a 44 px touch target in a 16 px row: -my-3.5
            // cancels the extra 28 px so it overhangs into the page's top
            // padding and this row's bottom margin instead of making the row
            // taller.
            <div className="-my-3.5">
              <ExportControl parts={exportParts} maxImages={EXPORT_PART_MAX_IMAGES} />
            </div>
          )}
        </div>

        {isGuest && images.length > 0 && (
          <div className="mb-6">
            <GuestKeepLine next="/designs" />
          </div>
        )}

        {images.length === 0 ? (
          <EmptyState
            message="No designs yet."
            action={
              <Link href="/studio">
                <Button>Go to Studio</Button>
              </Link>
            }
          />
        ) : (
          <LibraryGrid images={images} />
        )}
      </main>
    </div>
  );
}
