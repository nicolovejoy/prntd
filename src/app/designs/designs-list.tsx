"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { deleteDesign, archiveDesign, unpublishImage } from "./actions";
import {
  closeConversation,
  reopenConversation,
  startConversationFromImage,
} from "@/app/design/actions";
import { Badge, Button } from "@/components/ui";
import { PublishModal } from "@/components/publish-modal";
import { publishedBackdrop } from "@/lib/blanks";
import { designCardHref } from "@/lib/design-view";
import type { UserDesign } from "@/lib/user-designs";
import { WarmOnView } from "./warm-on-view";

// Matches the grid's responsive column count (grid-cols-2 / md:3), same
// reasoning as PublishedGrid (#127 slice 3).
const GRID_SIZES = "(max-width: 767px) 50vw, 33vw";

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function DesignsList({
  initialDesigns,
}: {
  initialDesigns: UserDesign[];
}) {
  const [designs, setDesigns] = useState<UserDesign[]>(initialDesigns);
  const [publishImageId, setPublishImageId] = useState<string | null>(null);
  const [publishImageUrl, setPublishImageUrl] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this design?")) return;
    try {
      // Expected refusals come back as { error } — prod masks thrown
      // server-action messages, so a throw here only ever shows the digest.
      const result = await deleteDesign(id);
      if (result?.error) {
        window.alert(result.error);
        return;
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
      return;
    }
    setDesigns((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleArchive(id: string) {
    await archiveDesign(id);
    setDesigns((prev) => prev.filter((d) => d.id !== id));
  }

  // Publishing opens the modal (name/description/backdrop), which performs
  // the publish and navigates to the new public page.
  function openPublish(imageId: string, imageUrl: string | null) {
    setPublishImageId(imageId);
    setPublishImageUrl(imageUrl);
  }

  // Close/Reopen (slice 3): flips the thread between writable and read-only.
  async function handleToggleClosed(design: UserDesign) {
    try {
      if (design.closedAt) {
        await reopenConversation(design.id);
      } else {
        await closeConversation(design.id);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
      return;
    }
    setDesigns((prev) =>
      prev.map((d) =>
        d.id === design.id
          ? { ...d, closedAt: design.closedAt ? null : new Date() }
          : d
      )
    );
  }

  // Fresh start (slice 3): a new conversation seeded by this design's image.
  async function handleStartFrom(imageId: string) {
    try {
      const { designId } = await startConversationFromImage(imageId);
      window.location.assign(`/design?id=${designId}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
    }
  }

  // Un-publish flips the card back to its unpublished state in place.
  async function handleUnpublish(imageId: string, designId: string) {
    if (!window.confirm("Take this design down from the storefront? You can re-publish it later.")) {
      return;
    }
    await unpublishImage(imageId);
    setDesigns((prev) =>
      prev.map((d) =>
        d.id === designId ? { ...d, primaryImagePublishedAt: null } : d
      )
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h1 className="text-xl sm:text-2xl font-bold">My Designs</h1>
          <Link href="/design" className="shrink-0">
            <Button size="sm">New Design</Button>
          </Link>
        </div>

        {designs.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-text-faint text-lg">No designs yet.</p>
            <Link href="/design">
              <Button>Start a design</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {designs.map((design) => {
              // Published designs render over their chosen storefront
              // backdrop (matching PublishedGrid; null → White, #73);
              // unpublished ones keep the checkerboard working view.
              const backdrop = design.primaryImagePublishedAt
                ? publishedBackdrop(design.primaryImageBackgroundColor)
                : { className: "bg-checkerboard", style: undefined };
              return (
              <WarmOnView
                key={design.id}
                designId={design.id}
                className="border rounded-lg overflow-hidden group"
              >
                <Link href={designCardHref(design)} className="block">
                  <div
                    className={`relative aspect-square flex items-center justify-center ${backdrop.className}`}
                    style={backdrop.style}
                  >
                    {design.imageUrl ? (
                      <Image
                        src={design.imageUrl}
                        alt="Design preview"
                        fill
                        sizes={GRID_SIZES}
                        loading="lazy"
                        decoding="async"
                        className="object-cover"
                      />
                    ) : (
                      <span className="text-text-muted text-sm">No image yet</span>
                    )}
                  </div>
                </Link>
                <div className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="flex items-center gap-1">
                      <Badge variant={design.status}>
                        {design.status}
                      </Badge>
                      {design.closedAt && <Badge>closed</Badge>}
                    </span>
                    <span className="text-xs text-text-muted whitespace-nowrap">
                      {timeAgo(new Date(design.updatedAt))}
                    </span>
                  </div>
                  <p className="text-xs text-text-faint">
                    {design.generationCount} generation{design.generationCount !== 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {design.status === "ordered" ? (
                      <>
                        <Link href={`/preview?id=${design.id}`}>
                          <Button size="sm">Reorder</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchive(design.id)}
                        >
                          Archive
                        </Button>
                      </>
                    ) : (
                      // #136 slice 2: "Edit" is gone — the card lands on the
                      // image page, which links through to the conversation.
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(design.id)}
                      >
                        Delete
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleClosed(design)}
                    >
                      {design.closedAt ? "Reopen" : "Close"}
                    </Button>
                  </div>
                  {design.primaryImageId && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartFrom(design.primaryImageId!)}
                        title="Start a new design from this image"
                      >
                        New from image
                      </Button>
                      {design.primaryImagePublishedAt ? (
                        // The old "Published →" link is dropped: the card
                        // itself now goes to that page.
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleUnpublish(design.primaryImageId!, design.id)
                          }
                        >
                          Un-publish
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            openPublish(
                              design.primaryImageId!,
                              design.imageUrl ?? null
                            )
                          }
                        >
                          Publish
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </WarmOnView>
              );
            })}
          </div>
        )}
      </main>

      <PublishModal
        imageId={publishImageId}
        imageUrl={publishImageUrl}
        open={publishImageId !== null}
        onClose={() => {
          setPublishImageId(null);
          setPublishImageUrl(null);
        }}
        from="/designs"
      />
    </div>
  );
}
