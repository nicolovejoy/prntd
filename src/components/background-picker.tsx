"use client";

import { useState } from "react";
import { BACKGROUND_PALETTE } from "@/lib/blanks";

/**
 * Backdrop swatches for a published design — shirt colors from the default
 * product palette. No "none"/transparent option: published art always sits
 * on a color in the Shop (#73). Presentational — the parent owns the
 * selected value and persistence. Phone-first: 40px touch targets.
 *
 * Collapsed by default: one short row of swatches plus a "+N more" button;
 * the selected color is always visible in the collapsed row (substituted
 * into the last slot when it falls outside the first few). Expanding shows
 * the full palette in place.
 */
const COLLAPSED_COUNT = 5;

export function BackgroundPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  let swatches = BACKGROUND_PALETTE;
  if (!expanded && BACKGROUND_PALETTE.length > COLLAPSED_COUNT) {
    const head = BACKGROUND_PALETTE.slice(0, COLLAPSED_COUNT);
    const selectedIndex = BACKGROUND_PALETTE.findIndex((c) => c.name === value);
    if (selectedIndex >= COLLAPSED_COUNT) {
      head[COLLAPSED_COUNT - 1] = BACKGROUND_PALETTE[selectedIndex];
    }
    swatches = head;
  }
  const hiddenCount = BACKGROUND_PALETTE.length - swatches.length;

  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        Background — {value}
      </label>
      <div className="flex flex-wrap items-center gap-2.5 md:gap-2">
        {swatches.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.name)}
            disabled={disabled}
            title={c.name}
            aria-label={c.name}
            aria-pressed={value === c.name}
            className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors disabled:opacity-50 ${
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
