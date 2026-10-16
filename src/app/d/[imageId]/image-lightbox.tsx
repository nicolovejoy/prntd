"use client";

import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

/**
 * The minimum an image needs to be shown here. The image detail page's
 * conversation strip is the one caller (#188 slice 2c moved this file next
 * to it when the /design thread, which also used it, was deleted).
 */
export type LightboxImage = {
  id: string;
  number: number;
  url: string;
};

/**
 * An image navigator: prev/next across `images`, Close, Escape and the arrow
 * keys. What can be done to the shown image is the caller's: it passes its
 * own controls as `actions`.
 */
export function ImageLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  actions,
}: {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Caller-specific controls for the shown image, rendered in the actions
   * row. The row renders only when this is given. */
  actions?: ReactNode;
}) {
  const image = images[currentIndex];
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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

  // Focus Close on open so keyboard/screen-reader users land inside the
  // dialog immediately. No focus trap — out of scope for this pass.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Restore focus to whatever opened this on unmount. Captured on mount, not
  // read fresh in the cleanup (by then `document.activeElement` is whatever
  // the dialog itself last focused, e.g. Close) — and captured in a LAYOUT
  // effect specifically so it runs before the passive "focus Close on mount"
  // effect above: passive effects run in declaration order, so a useEffect
  // here would capture Close itself, not the real opener. A strip thumbnail
  // tap is how this opens, so losing focus back to the top of the page on
  // close would be a real regression, not just a nicety. Guarded on the node
  // still being in the document — the opener can legitimately be gone by the
  // time this closes (e.g. the strip re-rendered without it).
  const previouslyFocused = useRef<Element | null>(null);
  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement;
    return () => {
      const el = previouslyFocused.current;
      if (el instanceof HTMLElement && document.contains(el)) {
        el.focus();
      }
    };
  }, []);

  if (!image) return null;

  const hasActions = actions != null && actions !== false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="image-lightbox"
      className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-4 max-w-4xl w-full px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <span className="text-sm text-text-muted font-mono">
            #{image.number} of {images.length}
          </span>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close"
            className="min-w-11 min-h-11 flex items-center justify-center text-text-muted hover:text-foreground text-2xl leading-none"
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
            className="min-w-11 min-h-11 flex items-center justify-center text-3xl text-text-muted hover:text-foreground disabled:opacity-20 shrink-0"
          >
            &lsaquo;
          </button>

          {/* Image container */}
          <div className="flex-1 flex items-center justify-center gap-4">
            <img
              src={image.url}
              alt={`Design #${image.number}`}
              className="max-h-[70vh] max-w-full object-contain rounded-lg"
            />
          </div>

          {/* Right arrow */}
          <button
            onClick={() =>
              currentIndex < images.length - 1 && onNavigate(currentIndex + 1)
            }
            disabled={currentIndex === images.length - 1}
            aria-label="Next image"
            className="min-w-11 min-h-11 flex items-center justify-center text-3xl text-text-muted hover:text-foreground disabled:opacity-20 shrink-0"
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
          </div>
        )}
      </div>
    </div>
  );
}
