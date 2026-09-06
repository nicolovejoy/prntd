"use client";

import { useEffect, useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * The minimum an image needs to be shown here. `DesignImage` (the /design
 * thread) is a structural superset; the image detail page's conversation
 * strip supplies the same fields.
 */
export type LightboxImage = {
  id: string;
  number: number;
  url: string;
  publishedAt?: Date | null;
  role?: "output" | "seed";
};

export function ImageLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  onDelete,
  onMakeProducts,
  onPublish,
  onStartFrom,
  actions,
}: {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Each action button renders only when its callback is given. */
  onDelete?: (imageId: string) => void;
  onMakeProducts?: (imageUrl: string) => void;
  onPublish?: (imageId: string) => void | Promise<void>;
  /** Fresh start (slice 3): open a new conversation seeded by this image. */
  onStartFrom?: (imageId: string) => void | Promise<void>;
  /** Consumer-specific controls for the shown image, rendered first in the
   * actions row. */
  actions?: ReactNode;
}) {
  const [publishing, setPublishing] = useState(false);
  const [starting, setStarting] = useState(false);
  const image = images[currentIndex];
  const isSeed = image?.role === "seed";
  const [sideBySide, setSideBySide] = useState(true);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // preventDefault so page-level Escape-to-go-up skips this keystroke.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === "ArrowRight" && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      }
    },
    [currentIndex, images.length, onClose, onNavigate]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (!image) return null;

  const hasActions =
    (actions != null && actions !== false) ||
    Boolean(onMakeProducts || onStartFrom || onPublish || onDelete);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="image-lightbox"
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-4 max-w-4xl w-full px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted font-mono">
              #{image.number} of {images.length}
            </span>
            <button
              onClick={() => setSideBySide((s) => !s)}
              className="text-[10px] px-2 py-0.5 rounded text-text-faint hover:text-text-muted transition-colors"
            >
              {sideBySide ? "Single view" : "Side by side"}
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-w-11 min-h-11 flex items-center justify-center text-text-muted hover:text-white text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Image */}
        <div className="relative flex items-center gap-4 w-full">
          {/* Left arrow */}
          <button
            onClick={() => currentIndex > 0 && onNavigate(currentIndex - 1)}
            disabled={currentIndex === 0}
            aria-label="Previous image"
            className="min-w-11 min-h-11 flex items-center justify-center text-3xl text-text-muted hover:text-white disabled:opacity-20 shrink-0"
          >
            &lsaquo;
          </button>

          {/* Image container */}
          <div className="flex-1 flex items-center justify-center gap-4">
            {sideBySide ? (
              <>
                <button
                  className="flex-1 flex items-center justify-center rounded-lg bg-gray-900 p-4 cursor-zoom-in"
                  onClick={() => setSideBySide(false)}
                >
                  <img
                    src={image.url}
                    alt={`Design #${image.number} on dark`}
                    className="max-h-[60vh] max-w-full object-contain"
                  />
                </button>
                <button
                  className="flex-1 flex items-center justify-center rounded-lg bg-white p-4 cursor-zoom-in"
                  onClick={() => setSideBySide(false)}
                >
                  <img
                    src={image.url}
                    alt={`Design #${image.number} on light`}
                    className="max-h-[60vh] max-w-full object-contain"
                  />
                </button>
              </>
            ) : (
              <img
                src={image.url}
                alt={`Design #${image.number}`}
                className="max-h-[70vh] max-w-full object-contain rounded-lg"
              />
            )}
          </div>

          {/* Right arrow */}
          <button
            onClick={() =>
              currentIndex < images.length - 1 && onNavigate(currentIndex + 1)
            }
            disabled={currentIndex === images.length - 1}
            aria-label="Next image"
            className="min-w-11 min-h-11 flex items-center justify-center text-3xl text-text-muted hover:text-white disabled:opacity-20 shrink-0"
          >
            &rsaquo;
          </button>
        </div>

        {/* Actions — only when there is something to put in the row. */}
        {hasActions && (
          <div
            className="flex flex-wrap gap-3 justify-center"
            data-testid="lightbox-actions"
          >
            {actions}
            {onMakeProducts && (
              <Button onClick={() => onMakeProducts(image.url)}>
                Make Products
              </Button>
            )}
            {onStartFrom && (
              <Button
                variant="secondary"
                disabled={!image.id || starting}
                onClick={async () => {
                  if (!image.id) return;
                  setStarting(true);
                  try {
                    await onStartFrom(image.id);
                  } finally {
                    setStarting(false);
                  }
                }}
                data-testid="start-from-image"
              >
                {starting ? "Starting…" : "New design from this"}
              </Button>
            )}
            {onPublish &&
              (isSeed ? null : image.publishedAt ? (
                <span className="self-center text-sm text-text-faint">
                  Published ·{" "}
                  <a
                    href={`/d/${image.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-text-muted"
                  >
                    view
                  </a>
                </span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={!image.id || publishing}
                  onClick={async () => {
                    if (!image.id) return;
                    setPublishing(true);
                    try {
                      await onPublish(image.id);
                    } finally {
                      setPublishing(false);
                    }
                  }}
                >
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
              ))}
            {onDelete && (
              <Button
                variant="danger"
                onClick={() => image.id && onDelete(image.id)}
                disabled={!image.id || (!isSeed && Boolean(image.publishedAt))}
                title={
                  isSeed
                    ? "Removes the starting image from this design only."
                    : image.publishedAt
                      ? "Published images cannot be deleted."
                      : undefined
                }
              >
                {/* A seed belongs to another design — removing it here only
                    detaches it from this thread (deleteDesignImage). */}
                {isSeed ? "Remove" : "Delete"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
