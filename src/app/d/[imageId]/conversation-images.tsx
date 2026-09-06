"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { setPrimaryImage } from "@/app/design/actions";
import { ImageLightbox, type LightboxImage } from "@/app/design/image-lightbox";
import { Button } from "@/components/ui";
import type { SiblingImage } from "../actions";

const STRIP_SIZES = "88px";

/**
 * Variant history for the owner (#136 slice 3): the other images this
 * conversation produced, plus the explicit "Use this one" that makes the
 * image being viewed the design's primary. Without that action the newest
 * generation always wins and preferring an earlier variant is unexpressible.
 *
 * Tapping a strip thumbnail opens the lightbox over it (#157) with prev/next
 * across the whole conversation, the page's own image included; "Use this
 * one" and a link to the sibling's own page are inside it for the shown image.
 */
export function ConversationImages({
  designId,
  currentImageId,
  images,
  initialPrimaryImageId,
  from,
}: {
  designId: string;
  currentImageId: string;
  images: SiblingImage[];
  initialPrimaryImageId: string | null;
  from?: string;
}) {
  const [primaryImageId, setPrimary] = useState(initialPrimaryImageId);
  const [saving, setSaving] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Owner backstop: getConversationImages returns an empty list for anyone
  // but the owner, and this strip (with its primary-setting action) is theirs.
  if (images.length === 0) return null;

  // Strip entries keep their index in the full list so a tap opens the
  // lightbox at the right position.
  const others = images
    .map((img, index) => ({ img, index }))
    .filter(({ img }) => img.imageId !== currentImageId);
  const isPrimary = primaryImageId === currentImageId;

  async function handleUse(imageId: string) {
    setSaving(true);
    try {
      await setPrimaryImage(designId, imageId);
      setPrimary(imageId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  }

  // Nothing to say when the design has a single image that's already primary.
  if (others.length === 0 && isPrimary) return null;

  const href = (imageId: string) =>
    from ? `/d/${imageId}?from=${encodeURIComponent(from)}` : `/d/${imageId}`;

  // `#N` = position in the full seed-inclusive list, which is the same order
  // the /design thread numbers its generations in.
  const lightboxImages: LightboxImage[] = images.map((img, i) => ({
    id: img.imageId,
    number: i + 1,
    url: img.imageUrl,
  }));
  const shown = lightboxIndex === null ? null : images[lightboxIndex];

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <div className="flex flex-wrap items-center gap-3">
        {isPrimary ? (
          <span className="text-sm text-text-faint">
            This is the design&rsquo;s current image.
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleUse(currentImageId)}
            disabled={saving}
          >
            {saving ? "Saving…" : "Use this one"}
          </Button>
        )}
      </div>

      {others.length > 0 && (
        <div>
          <h2 className="text-xs font-medium text-text-muted mb-2">
            Other images from this design
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {others.map(({ img, index }) => {
              const isCurrent = img.imageId === primaryImageId;
              return (
                <button
                  key={img.imageId}
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  aria-label={`Image #${index + 1}`}
                  aria-current={isCurrent ? "true" : undefined}
                  title={isCurrent ? "Current image" : undefined}
                  data-testid="conversation-image-thumb"
                  className={`relative shrink-0 w-[88px] aspect-square rounded-lg overflow-hidden border-2 bg-checkerboard ${
                    isCurrent ? "border-accent" : "border-border"
                  }`}
                >
                  <Image
                    src={img.imageUrl}
                    alt="Other version of this design"
                    fill
                    sizes={STRIP_SIZES}
                    loading="lazy"
                    decoding="async"
                    className="object-contain"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {lightboxIndex !== null && shown && (
        <ImageLightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          actions={
            <>
              {shown.imageId === primaryImageId ? (
                <span className="self-center text-sm text-text-faint">
                  This is the design&rsquo;s current image.
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => handleUse(shown.imageId)}
                >
                  {saving ? "Saving…" : "Use this one"}
                </Button>
              )}
              {shown.imageId !== currentImageId && (
                <Link
                  href={href(shown.imageId)}
                  className="self-center text-sm underline text-text-muted hover:text-foreground"
                >
                  Open
                </Link>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
