import Link from "next/link";
import { requireRealUser } from "@/lib/require-user";
import { getUserImageLibrary } from "@/lib/user-designs";
import { Button, EmptyState } from "@/components/ui";
import { LibraryGrid } from "./library-grid";

/**
 * Library — every image this user has made (studio-plan slice 5). Moved here
 * from /designs by nav model A: the bench holds the conversations you are
 * working on, this holds what came out of them, and they are two views of one
 * Studio rather than two top-level destinations.
 *
 * The heading and the tab strip come from src/app/studio/layout.tsx.
 *
 * A plain server component: the grid is links, so there is no client state to
 * hydrate. Per-image actions live one tap deeper, on the image detail page.
 */
export default async function StudioLibraryPage() {
  const session = await requireRealUser();
  const images = await getUserImageLibrary(session.user.id);

  return (
    <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
      {images.length === 0 ? (
        <EmptyState
          message="No designs yet."
          action={
            <Link href="/studio">
              <Button>Open the Studio</Button>
            </Link>
          }
        />
      ) : (
        <LibraryGrid images={images} />
      )}
    </main>
  );
}
