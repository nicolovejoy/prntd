"use client";

import { useState } from "react";
import { BACKGROUND_PALETTE } from "@/lib/blanks";

/**
 * Backdrop swatches for a published design — shirt colors from the default
 * product palette. No "none"/transparent option: published art always sits
 * on a color in the Shop (#73). Presentational — the parent owns the
 * selected value and persistence.
 *
 * Two modes (#140 — the publish modal and the /d owner picker want
 * different things from the same palette):
 * - "collapsed" (default): one short row of swatches plus a "+N more"
 *   button; the selected color is always visible in the collapsed row
 *   (substituted into the last slot when it falls outside the first few).
 *   Expanding shows the full palette in place. Used on /d where a backdrop
 *   is already set and swatches are a quick-change control.
 * - "full": every swatch shown at once in a wrapped grid, no collapse.
 *   Used in the publish modal, where picking the backdrop is a first-time,
 *   deliberate choice — narrowing the options first would hide the ones
 *   that matter. 44px touch targets throughout (not shrunk on desktop —
 *   this mode only appears inside a modal, not a dense page layout).
 */
const COLLAPSED_COUNT = 5;

export function BackgroundPicker({
  value,
  onChange,
  disabled = false,
  mode = "collapsed",
}: {
  /** Null means no backdrop chosen yet (full mode only — collapsed callers
   * always seed a value). No swatch renders as selected when null. */
  value: string | null;
  onChange: (color: string) => void;
  disabled?: boolean;
  mode?: "collapsed" | "full";
}) {
  const [expanded, setExpanded] = useState(false);

  let swatches = BACKGROUND_PALETTE;
  if (
    mode === "collapsed" &&
    !expanded &&
    BACKGROUND_PALETTE.length > COLLAPSED_COUNT
  ) {
    const head = BACKGROUND_PALETTE.slice(0, COLLAPSED_COUNT);
    const selectedIndex = BACKGROUND_PALETTE.findIndex((c) => c.name === value);
    if (selectedIndex >= COLLAPSED_COUNT) {
      head[COLLAPSED_COUNT - 1] = BACKGROUND_PALETTE[selectedIndex];
    }
    swatches = head;
  }
  const hiddenCount = BACKGROUND_PALETTE.length - swatches.length;

  const swatchClassName =
    mode === "full"
      ? "w-11 h-11 rounded-full border-2 transition-colors disabled:opacity-50"
      : "w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors disabled:opacity-50";

  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        {value ? `Background — ${value}` : "Background"}
      </label>
      <div
        className={
          mode === "full"
            ? "grid grid-cols-5 gap-3"
            : "flex flex-wrap items-center gap-2.5 md:gap-2"
        }
        data-testid={mode === "full" ? "background-picker-full" : undefined}
      >
        {swatches.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.name)}
            disabled={disabled}
            title={c.name}
            aria-label={c.name}
            aria-pressed={value === c.name}
            className={`${swatchClassName} ${
              value === c.name
                ? "border-accent ring-2 ring-offset-1 ring-accent ring-offset-background"
                : "border-border"
            }`}
            style={{ backgroundColor: c.value }}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            disabled={disabled}
            data-testid="background-picker-expand"
            className="h-10 md:h-8 px-3 rounded-full border border-border text-sm text-text-muted hover:border-text-muted transition-colors disabled:opacity-50"
          >
            +{hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}
