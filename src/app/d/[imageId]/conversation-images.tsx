"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { setPrimaryImage } from "@/app/design/actions";
import { Button } from "@/components/ui";
import type { SiblingImage } from "../actions";

const STRIP_SIZES = "88px";

/**
 * Variant history for the owner (#136 slice 3): the other images this
 * conversation produced, plus the explicit "Use this one" that makes the
 * image being viewed the design's primary. Without that action the newest
 * generation always wins and preferring an earlier variant is unexpressible.
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

  const others = images.filter((img) => img.imageId !== currentImageId);
  const isPrimary = primaryImageId === currentImageId;

  async function handleUsePrimary() {
    setSaving(true);
    try {
      await setPrimaryImage(designId, currentImageId);
      setPrimary(currentImageId);
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
            onClick={handleUsePrimary}
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
            {others.map((img) => (
              <Link
                key={img.imageId}
                href={href(img.imageId)}
                className={`relative shrink-0 w-[88px] aspect-square rounded-lg overflow-hidden border-2 bg-checkerboard ${
                  img.isPrimary ? "border-accent" : "border-border"
                }`}
                title={img.isPrimary ? "Current image" : undefined}
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
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
