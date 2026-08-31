import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getImagePage, getConversationImages } from "../actions";
import { getImageShareCard } from "@/lib/image-share";
import { getLastPurchaseDefaults } from "@/app/preview/actions";
import { auth, isAnonymousUser } from "@/lib/auth";
import { multiPlacementEnabled } from "@/lib/blanks";
import { cartEnabled } from "@/lib/flags";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { Button } from "@/components/ui";
import { EditableNaming } from "./editable-naming";
import { PublishedImageView } from "./published-image-view";
import { PublishCta } from "./publish-cta";
import { BuyHero } from "./buy-hero";
import { StartFromImage } from "./start-from-image";
import { ConversationImages } from "./conversation-images";

type Params = Promise<{ imageId: string }>;
type Search = Promise<{ from?: string }>;

/**
 * Caption for the link preview whose picture `opengraph-image.tsx` draws.
 * Same published-only rule, and for the same reason: an owner-private image
 * has no listing, so there is no title to leak and the site defaults stand.
 */
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { imageId } = await params;
  const card = await getImageShareCard(imageId);
  if (!card) return {};

  const title = card.title ?? "A design on PRNTD";
  const description = `Designed by ${card.designerName}. Put it on a shirt.`;
  // og:image is left to the file convention — naming it here would override
  // the generated card with a raw transparent PNG.
  return {
    title,
    description,
    openGraph: { type: "article", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublishedImagePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { imageId } = await params;
  const { from } = await searchParams;
  const img = await getImagePage(imageId);
  if (!img) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  // Anonymous (guest) sessions don't count as logged-in for the buy CTA — the
  // purchase point requires a real account. A guest sees "Sign in to buy".
  const isLoggedIn = Boolean(session) && !isAnonymousUser(session?.user);
  const isOwner = session?.user.id === img.designerId;
  // #136 slice 1: the page also serves the owner's unpublished work, where
  // there's no listing to name, re-backdrop or buy through the storefront.
  const isPublished = img.publishedAt !== null;

  // Remembered defaults (#44, §8 Q3): last purchase seeds product + size.
  // Null for guests/first purchase — the panel then starts unselected.
  const remembered = await getLastPurchaseDefaults();

  // #136 slice 3: the owner also gets the conversation's variant history and
  // the explicit "Use this one". Owner-gated in the action too.
  const siblings =
    isOwner && img.sourceDesignId
      ? await getConversationImages(img.sourceDesignId)
      : null;

  const trail = breadcrumbTrail(`/d/${imageId}`, { from });
  const up = trail.length > 0 ? trail[trail.length - 1] : null;

  // Title/naming/attribution block — identical for both branches below, so
  // it's computed once rather than duplicated. Renders between the hero and
  // the buy/remix CTA in both.
  const metaBlock = (
    <div className="space-y-1">
      <EditableNaming
        imageId={img.imageId}
        title={img.title}
        canEdit={isOwner && isPublished}
      />
      <p className="text-sm text-text-muted">by {img.designerName}</p>
      {isOwner && !isPublished && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-sm text-text-faint">Not published</span>
          <PublishCta imageId={img.imageId} imageUrl={img.imageUrl} />
        </div>
      )}
      {isOwner && img.sourceDesignId && (
        <p className="pt-1">
          <Link
            href={`/design?id=${img.sourceDesignId}`}
            className="text-sm text-text-muted underline hover:no-underline"
          >
            View conversation
          </Link>
        </p>
      )}
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
  );

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

          {/* #128: two peer exits — Order (expands the picker stack in
              place, and swaps the hero to the shirt-mockup preview, #135
              slice 1) and the remix action.

              Unpublished images can't go through the buy-existing path
              (canBuyPublishedImage has no owner shortcut), so for the owner's
              private work Order links out to /preview, which still owns
              ordering your own designs (#136 decision 4 — converging the two
              pipelines is a follow-up); the hero there has no mockup-preview
              swap to share with, so it stays the plain PublishedImageView. */}
          {!isPublished ? (
            <>
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
                  canEdit={false}
                />
              </div>

              {metaBlock}

              <div className="flex flex-wrap items-center gap-3">
                {img.sourceDesignId && (
                  <Link href={`/preview?id=${img.sourceDesignId}`}>
                    <Button>Order</Button>
                  </Link>
                )}
                <StartFromImage imageId={img.imageId} />
              </div>
            </>
          ) : (
            <BuyHero
              imageId={img.imageId}
              imageUrl={img.imageUrl}
              alt={img.title ?? "Design"}
              initialBackgroundColor={img.backgroundColor}
              canEdit={isOwner}
              backHref={up?.href}
              backLabel={up?.label}
              isLoggedIn={isLoggedIn}
              remembered={remembered}
              // Back affordance is signed-in only (back selection would be
              // lost through the sign-in redirect anyway) and flag-gated;
              // the server action re-checks both.
              backEnabled={isLoggedIn && multiPlacementEnabled()}
              // Add to cart mirrors /preview's gating: flag + size picked,
              // no auth gate (guests have carts; checkout gates sign-in,
              // #146).
              cartEnabled={cartEnabled()}
              startAction={<StartFromImage imageId={img.imageId} />}
            >
              {metaBlock}
            </BuyHero>
          )}

          {siblings && img.sourceDesignId && (
            <ConversationImages
              designId={img.sourceDesignId}
              currentImageId={img.imageId}
              images={siblings.images}
              initialPrimaryImageId={siblings.primaryImageId}
              from={from}
            />
          )}
        </div>
      </main>
    </div>
  );
}
