import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  getImagePage,
  getConversationImages,
  resolveInitialBack,
} from "../actions";
import { getImageShareCard } from "@/lib/image-share";
import { getLastPurchaseDefaults } from "@/app/preview/actions";
import { auth, isAnonymousUser } from "@/lib/auth";
import { multiPlacementEnabled } from "@/lib/blanks";
import { cartEnabled } from "@/lib/flags";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { IdentityBlock } from "./identity-block";
import { PublishedImageView } from "./published-image-view";
import { BuyHero } from "./buy-hero";
import { StartFromImage } from "./start-from-image";
import { ConversationImages } from "./conversation-images";
import { OwnerActions } from "./owner-actions";
import {
  backToResolve,
  buildInitialPicks,
  parseBuyPagePicks,
} from "@/lib/buy-page-picks";

type Params = Promise<{ imageId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Caption for the link preview whose picture `opengraph-image.tsx` draws.
 * Same published-only rule, and for the same reason: an owner-private image
 * has no listing, so there is no title to leak and the site defaults stand.
 *
 * `??` would let an empty-string title through — a nameless share card, and
 * empty text on the alt props and the breadcrumb below. Rows saved blank
 * before updatePublishedNaming started refusing them still exist.
 */
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { imageId } = await params;
  const card = await getImageShareCard(imageId);
  if (!card) return {};

  const title = card.title?.trim() || "A design on PRNTD";
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
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const img = await getImagePage(imageId);
  if (!img) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  // Anonymous (guest) sessions don't count as logged-in for the buy CTA — the
  // purchase point requires a real account. A guest sees "Sign in to buy".
  const isLoggedIn = Boolean(session) && !isAnonymousUser(session?.user);
  const isOwner = session?.user.id === img.designerId;
  // #136 slice 1: the page also serves the owner's unpublished work, where
  // there's no listing to name or re-backdrop. The owner orders it from the
  // same panel a Shop buyer uses (`img.canOrder`), with no Shop composition.
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

  // The buy panel's picks ride in the link (#278): parsed against the catalog
  // here, and the back image is checked against what this viewer may print.
  // Each invalid pick is dropped on its own. They apply to the owner's
  // unpublished image too (`img.canOrder`).
  const picks = parseBuyPagePicks(sp);
  const backId = backToResolve(picks, {
    buyable: img.canOrder,
    loggedIn: isLoggedIn,
    multiPlacement: multiPlacementEnabled(),
  });
  const initialBack = backId ? await resolveInitialBack(imageId, backId) : null;
  const initialPicks = buildInitialPicks(picks, initialBack, imageId);

  const trail = breadcrumbTrail(`/d/${imageId}`, { from });
  const up = trail.length > 0 ? trail[trail.length - 1] : null;

  // Publishing (or unpublishing) re-renders this same route with the other
  // state's props. BuyHero, the backdrop picker and the title editor all seed
  // client state from props once, at mount, and the two states render them at
  // the same position, so without a new key the hero kept the White backdrop it
  // mounted with and the title editor an empty draft. A key per publish state
  // remounts them. What the buyer picked survives: it rides in the URL and is
  // parsed again above.
  const stateKey = isPublished ? "published" : "private";

  // Title/attribution as one mono-labelled block, identical for both
  // branches below (design review, "/d/[imageId] image page"). The owner's
  // actions are NOT here — they collect under the OWNER row further down.
  const identityBlock = (
    <IdentityBlock
      key={stateKey}
      imageId={img.imageId}
      title={img.title}
      canEditTitle={isOwner && isPublished}
      designerName={img.designerName}
      forkChain={img.forkChain}
    />
  );

  // The owner's actions collect under one OWNER row, below the hero and panel.
  const ownerActions = isOwner && (
    <OwnerActions
      imageId={img.imageId}
      imageUrl={img.imageUrl}
      isPublished={isPublished}
      canPublish={isLoggedIn}
      // The conversation may be gone even when the image names one — an image
      // pinned by an order or a seed survives its thread's delete — so the row
      // is gated on the design row resolving.
      sourceDesignId={
        img.sourceDesignId && img.hasSourceConversation
          ? img.sourceDesignId
          : null
      }
      conversationArchived={img.sourceConversationArchived}
    />
  );

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 py-6 pb-[calc(13rem+env(safe-area-inset-bottom))] md:py-8 md:pb-8">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Desktop shows the full trail; on mobile the breadcrumb row is
              dropped to save vertical space — a floating back arrow over the
              image (below) takes its place. */}
          <Breadcrumbs
            trail={trail}
            current={img.title?.trim() || "Design"}
            className="hidden sm:block"
          />

          {/* #128: two peer exits — Order (expands the picker stack in
              place, and swaps the hero to the shirt-mockup preview, #135
              slice 1) and the remix action.

              Published images and the owner's own unpublished ones share the
              panel (`img.canOrder`; one buy surface, slice 3). An unpublished
              order books no Shop composition and has no backdrop picker (no
              publication to pin it on), so `canEdit` stays published-only.
              An image whose conversation is gone can't be ordered
              (`order.design_id` is NOT NULL), so it gets the plain hero and
              no Order. */}
          {img.canOrder ? (
            <>
              <BuyHero
                key={stateKey}
                imageId={img.imageId}
                imageUrl={img.imageUrl}
                alt={img.title?.trim() || "Design"}
                initialBackgroundColor={img.backgroundColor}
                canEdit={isOwner && isPublished}
                backHref={up?.href}
                backLabel={up?.label}
                isLoggedIn={isLoggedIn}
                remembered={remembered}
                // Back affordance is signed-in only (the picker lists the
                // viewer's own designs, and a link's `back` is resolved only
                // for a signed-in viewer) and flag-gated; the server action
                // re-checks both.
                backEnabled={isLoggedIn && multiPlacementEnabled()}
                // Add to cart mirrors /preview's gating: flag + size picked,
                // no auth gate (guests have carts; checkout gates sign-in,
                // #146).
                cartEnabled={cartEnabled()}
                initialPicks={initialPicks}
                startAction={<StartFromImage imageId={img.imageId} />}
              >
                {identityBlock}
              </BuyHero>

              {ownerActions}
            </>
          ) : (
            <>
              <div className="relative">
                {up && (
                  <Link
                    href={up.href}
                    aria-label={`Back to ${up.label}`}
                    className="sm:hidden absolute top-2 left-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-foreground bg-background text-foreground"
                  >
                    <span aria-hidden>←</span>
                  </Link>
                )}
                <PublishedImageView
                  imageId={img.imageId}
                  imageUrl={img.imageUrl}
                  alt={img.title?.trim() || "Design"}
                  initialBackgroundColor={img.backgroundColor}
                  canEdit={false}
                />
              </div>

              {identityBlock}

              <div className="flex flex-wrap items-center gap-3">
                <StartFromImage imageId={img.imageId} />
              </div>

              {ownerActions}
            </>
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
