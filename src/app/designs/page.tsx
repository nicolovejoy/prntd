import Link from "next/link";
import { requireStudioUser } from "@/lib/require-user";
import { getUserImageLibrary } from "@/lib/user-designs";
import { Button, EmptyState } from "@/components/ui";
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
 * with no session cookie never gets here — middleware sends them to
 * /sign-in.
 *
 * A server component. The grid (LibraryGrid) is the client island: tiles are
 * links, plus the Active/All filter and select mode for bulk delete (#195,
 * #238). Per-image actions live one tap deeper, on the image detail page.
 *
 * Guests (#241) get their own images and, once there is at least one, the
 * sign-up/sign-in line. An empty library shows only its empty state: "keep
 * these designs" beside "No designs yet." reads wrong.
 */
export default async function DesignsPage() {
  const { session, isGuest } = await requireStudioUser();
  const images = await getUserImageLibrary(session.user.id);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
        <div className="mb-6">
          {/* Mono masthead, same class string as /orders and /shop use. */}
          <h1 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            My Designs
          </h1>
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
