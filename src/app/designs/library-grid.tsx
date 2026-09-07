"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { publishedBackdrop } from "@/lib/blanks";
import { Button, EmptyState, useConfirm } from "@/components/ui";
import {
  bulkImageDeleteConsequence,
  bulkImageDeleteNotice,
  bulkImageDeleteTitle,
} from "@/lib/library-view";
import type { LibraryImage } from "@/lib/user-designs";
import { deleteImages } from "./actions";

// Matches the column count below (3 on a phone, 4/5 wider) so the browser
// requests a thumbnail rather than the full-res R2 PNG (#127 slice 3).
const GRID_SIZES = "(max-width: 767px) 33vw, (max-width: 1023px) 25vw, 20vw";

/**
 * My Designs: the user's images, newest first (studio-plan slice 5). A cell
 * taps through to the image detail page, which is where everything you can do
 * with one image lives — order it, publish it, start a new conversation from
 * it, or open the conversation that made it.
 *
 * Select mode (#195) is the exception: the one thing worth doing to many
 * images at once is deleting them, so the grid owns a selection and a bulk
 * delete, mirroring the Studio bench. While selecting, a tile toggles rather
 * than navigating.
 *
 * Three columns at 390px: the whole cell is the tap target, so it clears 44px
 * with room to spare, and the grid never scrolls sideways.
 */
export function LibraryGrid({ images }: { images: LibraryImage[] }) {
  const [shown, setShown] = useState(images);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { confirm, element: confirmSheet } = useConfirm();

  // The page re-renders with a fresh list after a revalidate; adopt it rather
  // than keeping the mount-time snapshot forever.
  useEffect(() => {
    setShown(images);
  }, [images]);

  useEffect(() => {
    if (!selectMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") exitSelectMode();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode]);

  function enterSelectMode() {
    setSelectMode(true);
    setSelected(new Set());
    setNotice(null);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelected(imageId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }

  // One confirm, then one action for the whole selection. Optimistic: the
  // selected tiles leave now, and the ones the server kept come back with a
  // plain line saying why (the image-level rules live server-side — an image
  // an order prints can never be deleted from here).
  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0 || deleting) return;
    const ok = await confirm({
      title: bulkImageDeleteTitle(ids.length),
      body: bulkImageDeleteConsequence(ids.length),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    const prev = shown;
    const chosen = new Set(ids);
    setDeleting(true);
    setShown((list) => list.filter((i) => !chosen.has(i.imageId)));
    try {
      const result = await deleteImages(ids);
      const gone = new Set(result.deleted);
      setShown(prev.filter((i) => !gone.has(i.imageId)));
      setNotice(bulkImageDeleteNotice(result.skipped));
      exitSelectMode();
    } catch {
      setShown(prev);
      setNotice("Couldn't delete those images. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {confirmSheet}

      {/* Controls above the grid: one quiet Select, which becomes the count +
          the three verbs. Buttons keep the 44px floor and wrap rather than
          crowd on a narrow phone. */}
      {(shown.length > 0 || selectMode) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {selectMode ? (
            <>
              <span
                className="text-sm tabular-nums mr-auto"
                data-testid="library-selected-count"
              >
                {selected.size} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => setSelected(new Set(shown.map((i) => i.imageId)))}
                disabled={shown.length === 0 || selected.size === shown.length}
                data-testid="library-select-all"
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="min-h-11"
                onClick={() => void bulkDelete()}
                disabled={selected.size === 0 || deleting}
                data-testid="library-delete"
              >
                Delete ({selected.size})
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={exitSelectMode}
                disabled={deleting}
                data-testid="library-cancel"
              >
                Cancel
              </Button>
            </>
          ) : (
            <button
              type="button"
              onClick={enterSelectMode}
              className="ml-auto min-h-11 px-1 text-sm text-text-muted hover:text-foreground transition-colors"
              data-testid="library-select"
            >
              Select
            </button>
          )}
        </div>
      )}

      {notice && (
        <p className="mb-3 text-xs text-text-muted" data-testid="library-notice">
          {notice}
        </p>
      )}

      {shown.length === 0 ? (
        // Only reachable by deleting the last image — the page renders its
        // own empty state on a cold load. Same line, so the screen doesn't
        // change its mind about what to call this.
        <EmptyState message="No designs yet." />
      ) : (
        <div
          data-testid="library-grid"
          className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3"
        >
          {shown.map((img) => (
            <LibraryCell
              key={img.imageId}
              image={img}
              selectMode={selectMode}
              selected={selected.has(img.imageId)}
              onToggle={toggleSelected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryCell({
  image: img,
  selectMode,
  selected,
  onToggle,
}: {
  image: LibraryImage;
  selectMode: boolean;
  selected: boolean;
  onToggle: (imageId: string) => void;
}) {
  // Published images sit on their chosen storefront backdrop (null → White,
  // #73); unpublished work keeps the paper well working view.
  const backdrop = img.isPublished
    ? publishedBackdrop(img.backgroundColor)
    : { className: "bg-checkerboard", style: undefined };
  const marker = [
    img.isPublished ? "Published" : null,
    img.isArchived ? "Archived" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tile = (
    <>
      <div
        data-testid="library-tile"
        className={`relative aspect-square rounded-md overflow-hidden border transition-colors ${
          selected
            ? "border-accent ring-2 ring-accent"
            : "border-border group-hover:border-accent"
        } ${backdrop.className}`}
        style={backdrop.style}
      >
        <Image
          src={img.imageUrl}
          alt="Design"
          fill
          sizes={GRID_SIZES}
          loading="lazy"
          decoding="async"
          className="object-contain"
        />
        {selected && (
          <span
            aria-hidden
            data-testid="library-tile-checked"
            className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs text-accent-fg"
          >
            ✓
          </span>
        )}
      </div>
      {/* Quiet marker under the tile rather than over the artwork: one line,
          house type scale and text tokens, and it never covers the thing the
          cell exists to show. */}
      {marker && <p className="mt-1 text-xs text-text-faint truncate">{marker}</p>}
    </>
  );

  // In select mode the cell must not navigate, so it is a button rather than
  // a link with its default suppressed — nothing to miss on a middle-click or
  // a keyboard Enter.
  if (selectMode) {
    return (
      <button
        type="button"
        onClick={() => onToggle(img.imageId)}
        aria-pressed={selected}
        aria-label="Select design"
        className="group block w-full text-left"
      >
        {tile}
      </button>
    );
  }

  return (
    <Link href={`/d/${img.imageId}?from=/designs`} className="group block">
      {tile}
    </Link>
  );
}
