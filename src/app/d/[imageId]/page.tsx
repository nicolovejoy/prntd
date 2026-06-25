import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublishedImage } from "../actions";
import { auth, isAnonymousUser } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { EditableNaming } from "./editable-naming";
import { PublishedImageView } from "./published-image-view";
import { BuyPanel } from "./buy-panel";

type Params = Promise<{ imageId: string }>;
type Search = Promise<{ from?: string }>;

export default async function PublishedImagePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { imageId } = await params;
  const { from } = await searchParams;
  const img = await getPublishedImage(imageId);
  if (!img) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  // Anonymous (guest) sessions don't count as logged-in for the buy CTA — the
  // purchase point requires a real account. A guest sees "Sign in to buy".
  const isLoggedIn = Boolean(session) && !isAnonymousUser(session?.user);
  const isOwner = session?.user.id === img.designerId;

  const trail = breadcrumbTrail(`/d/${imageId}`, { from });
  const up = trail.length > 0 ? trail[trail.length - 1] : null;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 py-6 pb-28 md:py-8 md:pb-8">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Desktop shows the full trail; on mobile the breadcrumb row is
              dropped to save vertical space — a floating back arrow over the
              image (below) takes its place. */}
          <Breadcrumbs
            trail={trail}
            current={img.title ?? "Design"}
            className="hidden sm:block"
          />
          <div className="relative">
            {up && (
              <Link
                href={up.href}
                aria-label={`Back to ${up.label}`}
                className="sm:hidden absolute top-2 left-2 z-10 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/45 text-white backdrop-blur-sm"
              >
                <span aria-hidden>←</span>
              </Link>
            )}
            <PublishedImageView
              imageId={img.imageId}
              imageUrl={img.imageUrl}
              alt={img.title ?? "Design"}
              initialBackgroundColor={img.backgroundColor}
              canEdit={isOwner}
            />
          </div>

          <div className="space-y-1">
            <EditableNaming
              imageId={img.imageId}
              title={img.title}
              description={img.description}
              canEdit={isOwner}
            />
            <p className="text-sm text-text-muted">by {img.designerName}</p>
            {img.forkChain.length > 0 && (
              <p className="text-sm text-text-faint">
                Forked from{" "}
                {img.forkChain.map((link, i) => (
                  <span key={link.imageId}>
                    {i > 0 && " ← "}
                    <Link
                      href={`/d/${link.imageId}`}
                      className="underline hover:text-text-muted"
                    >
                      {link.title ?? "an earlier design"}
                    </Link>{" "}
                    by {link.designerName}
                  </span>
                ))}
              </p>
            )}
          </div>

          <BuyPanel
            imageId={img.imageId}
            isLoggedIn={isLoggedIn}
            preferredColor={img.backgroundColor}
          />
        </div>
      </main>
    </div>
  );
}
