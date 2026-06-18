"use client";

import type { BlankColor } from "@/lib/blanks";

/**
 * Size + color selectors shared by the order flow (`/order`) and the
 * buy-existing flow (`/d/[imageId]`). Presentational only — parents own
 * the selected state and any price/mockup side effects. Phone-first: 40px+
 * touch targets per the mobile-UX guidance.
 */
export function SizePicker({
  sizes,
  value,
  onChange,
  label = "Size",
}: {
  sizes: string[];
  value: string;
  onChange: (size: string) => void;
  label?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      <div className="flex flex-wrap gap-2">
        {sizes.map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`px-3 py-2.5 md:py-1.5 border-2 rounded-md text-sm transition-colors ${
              value === s
                ? "border-accent bg-accent text-accent-fg font-medium"
                : "border-border text-text-muted hover:border-border-hover"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Color swatches. Renders nothing when the product has a single color, so
 * callers can drop it in unconditionally.
 */
export function ColorPicker({
  colors,
  value,
  onChange,
}: {
  colors: BlankColor[];
  value: string;
  onChange: (color: string) => void;
}) {
  if (colors.length <= 1) return null;
  return (
    <div>
      <label className="block text-sm font-medium mb-2">Color — {value}</label>
      <div className="flex flex-wrap gap-2.5 md:gap-2">
        {colors.map((c) => (
          <button
            key={c.name}
            onClick={() => onChange(c.name)}
            className={`w-10 h-10 md:w-8 md:h-8 rounded-full border-2 transition-colors ${
              value === c.name
                ? "border-accent ring-2 ring-offset-1 ring-accent ring-offset-background"
                : "border-border"
            }`}
            style={{ backgroundColor: c.value }}
            title={c.name}
          />
        ))}
      </div>
    </div>
  );
}
