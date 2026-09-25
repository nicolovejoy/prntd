import Link from "next/link";
import { requireStudioUser } from "@/lib/require-user";
import { getUserImageLibrary } from "@/lib/user-designs";
import { Button, EmptyState } from "@/components/ui";
import { LibraryGrid } from "./library-grid";
import { GuestKeepLine } from "../guest-keep-line";

/**
 * Library — every image this user has made (studio-plan slice 5). Moved here
 * from /designs by nav model A: the bench holds the conversations you are
 * working on, this holds what came out of them, and they are two views of one
 * Studio rather than two top-level destinations.
 *
 * The heading and the tab strip come from src/app/studio/layout.tsx.
 *
 * A server component. The grid (LibraryGrid) is the client island: tiles are
 * links, plus the Active/All filter and select mode for bulk delete (#195,
 * #238). Per-image actions live one tap deeper, on the image detail page.
 *
 * Guests (#241) get their own images and the sign-up line, like the bench.
 */
export default async function StudioLibraryPage() {
  const { session, isGuest } = await requireStudioUser();
  const images = await getUserImageLibrary(session.user.id);

  return (
    <>
      {isGuest && <GuestKeepLine />}
      {/* 24px under the tab strip, the bench's default 24px. The layout
          contributes nothing below the strip, so each view owns this
          number; they used to disagree (24 / 32 / 32). */}
      <main className="px-4 sm:px-6 pt-6 pb-8 max-w-4xl mx-auto w-full">
        {images.length === 0 ? (
          <EmptyState
            message="No designs yet."
            action={
              <Link href="/studio">
                <Button>Go to Bench</Button>
              </Link>
            }
          />
        ) : (
          <LibraryGrid images={images} />
        )}
      </main>
    </>
  );
}
