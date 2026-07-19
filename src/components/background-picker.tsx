"use client";

import { BACKGROUND_PALETTE } from "@/lib/blanks";

/**
 * Backdrop swatches for a published design — shirt colors from the default
 * product palette. No "none"/transparent option: published art always sits
 * on a color in the Shop (#73). Presentational — the parent owns the
 * selected value and persistence. Phone-first: 40px touch targets.
 */
export function BackgroundPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        Background — {value}
      </label>
      <div className="flex flex-wrap gap-2.5 md:gap-2">
        {BACKGROUND_PALETTE.map((c) => (
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
      </div>
    </div>
  );
}
