"use client";

import { useState } from "react";
import { FullscreenViewer } from "@/components/fullscreen-viewer";
import { mockupBackdrop } from "@/lib/instant-preview";
import type { CheckoutLineSummary } from "@/lib/embedded-checkout-session";

type FaceSide = "front" | "back";

/**
 * One line of the checkout order summary (moved out of `ReviewBlock` in
 * page.tsx so it can hold state). Tapping the front tile, or the back
 * thumbnail, opens the viewer (#285) on that face. The viewer is a portal and
 * the open state lives here, so the Stripe form beside the summary is not
 * re-rendered or remounted; only the overlay sits above it.
 *
 * The face is what the tile already shows: the cached front mockup, else the
 * artwork on the shirt colour. The summary has no back mockup, only the back
 * artwork, so the back face is that artwork on the shirt colour.
 */
export function CheckoutLine({ line }: { line: CheckoutLineSummary }) {
  const [viewing, setViewing] = useState<FaceSide | null>(null);

  const hasFront = Boolean(line.mockupUrl || line.frontImageUrl);
  const hasBack = Boolean(line.backImageUrl);
  const name = line.productName ?? "Shirt";
  const options =
    hasFront && hasBack
      ? [
          { key: "front", label: "Front" },
          { key: "back", label: "Back" },
        ]
      : undefined;

  const tileContent = line.mockupUrl ? (
    <span
      className="absolute inset-0 block"
      style={{ backgroundColor: mockupBackdrop(line.colorHex) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={line.mockupUrl}
        alt=""
        className="w-full h-full object-contain mix-blend-multiply"
      />
    </span>
  ) : (
    line.frontImageUrl && (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={line.frontImageUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-contain p-1.5"
      />
    )
  );

  return (
    <div className="border-t border-border pt-4 space-y-2">
      <div className="flex items-center gap-3 md:flex-col md:items-stretch md:gap-2">
        <div
          data-testid="checkout-preview"
          className="relative w-24 h-24 md:w-full md:h-auto md:aspect-square border border-border overflow-hidden flex-shrink-0"
          style={{ backgroundColor: line.colorHex }}
        >
          {hasFront ? (
            <button
              type="button"
              aria-label="View larger"
              onClick={() => setViewing("front")}
              // Inset outline: the tile is overflow-hidden, which would clip
              // the browser's default outside-the-box focus ring.
              className="absolute inset-0 block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-foreground focus-visible:-outline-offset-2"
            >
              {tileContent}
            </button>
          ) : (
            tileContent
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm">
            {name}
            {line.quantity > 1 && ` ×${line.quantity}`}
          </p>
          <p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            {line.color} / {line.size}
          </p>
        </div>
      </div>

      {line.backImageUrl && (
        <div className="flex items-center gap-2 pl-1">
          <button
            type="button"
            aria-label="View back design larger"
            onClick={() => setViewing("back")}
            className="min-h-11 min-w-11 flex items-center justify-center flex-shrink-0 cursor-zoom-in"
          >
            <span
              className="block w-10 h-10 border border-border overflow-hidden"
              style={{ backgroundColor: line.colorHex }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={line.backImageUrl}
                alt=""
                className="w-full h-full object-contain p-1"
              />
            </span>
          </button>
          <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
            Back design
          </span>
        </div>
      )}

      {viewing && (
        <FullscreenViewer
          label={`${name}, larger view`}
          onClose={() => setViewing(null)}
          options={options}
          activeKey={viewing}
          onSelect={(key) => setViewing(key === "back" ? "back" : "front")}
        >
          <Face line={line} side={viewing} name={name} />
        </FullscreenViewer>
      )}
    </div>
  );
}

function Face({
  line,
  side,
  name,
}: {
  line: CheckoutLineSummary;
  side: FaceSide;
  name: string;
}) {
  if (side === "front" && line.mockupUrl) {
    return (
      <div
        data-testid="checkout-viewer-face"
        data-side="front"
        className="isolate h-full w-full"
        style={{ backgroundColor: mockupBackdrop(line.colorHex) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={line.mockupUrl}
          alt={`${name} in ${line.color}`}
          className="h-full w-full object-contain mix-blend-multiply"
        />
      </div>
    );
  }
  const src = side === "front" ? line.frontImageUrl : line.backImageUrl;
  return (
    <div
      data-testid="checkout-viewer-face"
      data-side={side}
      className="h-full w-full"
      style={{ backgroundColor: line.colorHex }}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${side === "front" ? "Front" : "Back"} design on a ${line.color} ${name}`}
          className="h-full w-full object-contain p-[12%]"
        />
      )}
    </div>
  );
}
