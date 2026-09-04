import Link from "next/link";
import { requireRealUser } from "@/lib/require-user";
import { getUserImageLibrary } from "@/lib/user-designs";
import { Button } from "@/components/ui";
import { LibraryGrid } from "./library-grid";

/**
 * My Designs — the library of images the user has made (studio-plan slice 5).
 * The Studio holds the conversations you are working on; this holds what came
 * out of them.
 *
 * A plain server component: the grid is links, so there is no client state to
 * hydrate. Per-image actions live one tap deeper, on the image detail page.
 */
export default async function DesignsPage() {
  const session = await requireRealUser();
  const images = await getUserImageLibrary(session.user.id);

  return (
    <main className="px-4 sm:px-6 py-8 max-w-5xl mx-auto w-full">
      <h1 className="text-xl sm:text-2xl font-bold mb-6">My Designs</h1>

      {images.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-text-faint">No designs yet.</p>
          <Link href="/studio">
            <Button>Open the Studio</Button>
          </Link>
        </div>
      ) : (
        <LibraryGrid images={images} />
      )}
    </main>
  );
}
