"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { SizePicker, ColorPicker } from "@/components/product-options";
import {
  ACTIVE_BLANKS,
  getColorHex,
  getDefaultPlacement,
  getOptionalPlacements,
  type Blank,
} from "@/lib/blanks";
import {
  estimateComposeCogs,
  computeProceeds,
  minViablePrice,
  suggestedPrice,
} from "@/lib/pricing";
import { checkProductFit } from "@/lib/product-compose";
import type { ComposableDesign } from "../actions";

function isDarkColor(hex: string): boolean {
  const m = hex.replace("#", "");
  if (m.length < 6) return false;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // Rec. 601 luma; below ~0.6 reads as a colored/dark garment for the knockout rule.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export type ComposeValues = {
  designId: string;
  blankId: string;
  placements: Record<string, string>;
  price: number | null;
};

/**
 * Shared design × blank × placement × price form behind both the new-product
 * and edit-product pages. New passes a pickable list of designs; edit passes a
 * single locked design (a product's design is fixed — only blank/placement/price
 * move). The page owns the server action + redirect via onSubmit.
 */
export function ComposeForm({
  designs,
  lockDesignId,
  initialBlankId,
  initialPlacementId,
  initialPrice,
  submitLabel,
  onSubmit,
}: {
  designs: ComposableDesign[];
  lockDesignId?: string;
  initialBlankId?: string;
  initialPlacementId?: string;
  initialPrice?: number | null;
  submitLabel: string;
  onSubmit: (values: ComposeValues) => Promise<void>;
}) {
  const startBlankId =
    initialBlankId && ACTIVE_BLANKS.some((b) => b.id === initialBlankId)
      ? initialBlankId
      : ACTIVE_BLANKS[0].id;
  const startBlank = ACTIVE_BLANKS.find((b) => b.id === startBlankId)!;

  const [designId, setDesignId] = useState<string | null>(
    lockDesignId ?? designs[0]?.designId ?? null
  );
  const [blankId, setBlankId] = useState<string>(startBlankId);
  const [size, setSize] = useState(startBlank.sizes[0] ?? "M");
  const [color, setColor] = useState<string>(startBlank.colors[0].name);
  const [placementId, setPlacementId] = useState(
    initialPlacementId ?? "front"
  );
  // null = follow the live suggestion; a string = the organizer's override.
  const [priceInput, setPriceInput] = useState<string | null>(
    initialPrice != null ? String(initialPrice) : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blank = useMemo<Blank>(
    () => ACTIVE_BLANKS.find((b) => b.id === blankId) ?? ACTIVE_BLANKS[0],
    [blankId]
  );
  const placements = useMemo(
    () => [getDefaultPlacement(blank), ...getOptionalPlacements(blank)],
    [blank]
  );
  const design = designs.find((d) => d.designId === designId) ?? null;

  // Switching blank may invalidate size/color/placement — reset them here, in
  // the event handler (not an effect), to the new blank's defaults.
  function selectBlank(b: Blank) {
    setBlankId(b.id);
    if (!b.sizes.includes(size)) setSize(b.sizes[0]);
    if (!b.colors.some((c) => c.name === color)) setColor(b.colors[0].name);
    const pls = [getDefaultPlacement(b), ...getOptionalPlacements(b)];
    if (!pls.some((p) => p.id === placementId)) setPlacementId(pls[0].id);
  }

  // Live economics — all pure, no server roundtrip.
  const cogs = useMemo(() => estimateComposeCogs(blankId, size), [blankId, size]);
  const floor = useMemo(() => minViablePrice(cogs), [cogs]);
  const suggested = useMemo(() => suggestedPrice(cogs), [cogs]);

  // Price follows the suggestion until the organizer types an override.
  const priceStr = priceInput ?? String(suggested);
  const priceNum = parseFloat(priceStr) || 0;
  const breakdown = useMemo(
    () => computeProceeds(priceNum, cogs),
    [priceNum, cogs]
  );
  const belowFloor = priceNum > 0 && priceNum < floor;

  const fit = useMemo(() => {
    if (!design) return null;
    return checkProductFit({
      blankId,
      placementId,
      aspectRatio: design.aspectRatio,
      coloredGarment: isDarkColor(getColorHex(blankId, color)),
    });
  }, [design, blankId, placementId, color]);

  async function save() {
    if (!design || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        designId: design.designId,
        blankId,
        placements: { [placementId]: design.imageId },
        price: priceNum > 0 ? priceNum : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the product");
      setSaving(false);
    }
  }

  return (
    <>
      {/* Design picker (new mode). Locked products show a fixed preview only. */}
      {!lockDesignId && (
        <section className="mt-5">
          <label className="block text-sm font-medium mb-2">Design</label>
          {designs.length === 0 && (
            <p className="text-sm text-text-faint">
              No designs yet. Make one first, then come back to add it to your shop.
            </p>
          )}
          {designs.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {designs.map((d) => (
                <button
                  key={d.designId}
                  onClick={() => setDesignId(d.designId)}
                  className={`shrink-0 w-20 h-20 rounded-md border-2 overflow-hidden transition-colors ${
                    d.designId === designId ? "border-accent" : "border-border"
                  }`}
                  style={{ backgroundColor: getColorHex(blankId, color) }}
                  title="Select design"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={d.imageUrl}
                    alt="design"
                    className="w-full h-full object-contain"
                  />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Live preview — artwork on the blank's color (Printful mockup reuse is a follow-up) */}
      {design && (
        <div
          className="mt-4 mx-auto w-48 h-48 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: getColorHex(blankId, color) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={design.imageUrl} alt="preview" className="max-w-[70%] max-h-[70%] object-contain" />
        </div>
      )}

      {/* Blank */}
      <section className="mt-5">
        <label className="block text-sm font-medium mb-2">Blank</label>
        <div className="flex flex-wrap gap-2">
          {ACTIVE_BLANKS.map((b) => (
            <button
              key={b.id}
              onClick={() => selectBlank(b)}
              className={`min-h-[44px] px-3 py-2 border-2 rounded-md text-sm transition-colors ${
                b.id === blankId
                  ? "border-accent bg-accent text-accent-fg font-medium"
                  : "border-border text-text-muted hover:border-border-hover"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </section>

      {/* Placement (only when the blank has more than the default) */}
      {placements.length > 1 && (
        <section className="mt-5">
          <label className="block text-sm font-medium mb-2">Placement</label>
          <div className="flex flex-wrap gap-2">
            {placements.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlacementId(p.id)}
                className={`min-h-[44px] px-3 py-2 border-2 rounded-md text-sm capitalize transition-colors ${
                  p.id === placementId
                    ? "border-accent bg-accent text-accent-fg font-medium"
                    : "border-border text-text-muted hover:border-border-hover"
                }`}
              >
                {p.id}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SizePicker sizes={blank.sizes} value={size} onChange={setSize} />
        <ColorPicker colors={blank.colors} value={color} onChange={setColor} />
      </div>

      {/* Validity — warn + fix, never block */}
      {fit && !fit.ok && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium text-amber-300">Heads up</p>
          <ul className="mt-1 space-y-1">
            {fit.warnings.map((w) => (
              <li key={w.code} className="text-sm text-text-muted">
                {w.message}{" "}
                {w.remediation && (
                  <span className="text-text-faint">— {w.remediation}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Price + live proceeds */}
      <section className="mt-5">
        <label className="block text-sm font-medium mb-2">Your price</label>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={priceStr}
            onChange={(e) => setPriceInput(e.target.value)}
            className="w-32 min-h-[44px] px-3 py-2 bg-surface border border-border rounded-md text-white focus:border-border-hover focus:outline-none"
          />
          <button
            onClick={() => setPriceInput(null)}
            className="text-xs text-text-muted hover:text-foreground underline"
          >
            suggest {usd(suggested)}
          </button>
        </div>

        {belowFloor && (
          <p className="mt-2 text-sm text-amber-300">
            At this price your team receives less than {usd(5)}. Floor is{" "}
            {usd(floor)}.
          </p>
        )}

        <dl className="mt-3 rounded-md border border-border p-3 text-sm space-y-1">
          <Row label="Customer pays" value={usd(breakdown.gross)} sub="incl. shipping" />
          <Row label="Stripe fee" value={`− ${usd(breakdown.stripeFee)}`} />
          <Row label="Printful (est.)" value={`− ${usd(breakdown.cogs)}`} />
          <Row label="PRNTD" value={`− ${usd(breakdown.opsFee)}`} />
          <div className="border-t border-border my-1" />
          <Row
            label="Your team gets"
            value={`≈ ${usd(Math.max(0, breakdown.orgProceeds))}`}
            strong
          />
        </dl>
      </section>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-5 flex gap-2">
        <Button
          type="button"
          variant="primary"
          className="min-h-[44px]"
          disabled={!design || saving}
          onClick={save}
        >
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={strong ? "font-medium" : "text-text-muted"}>
        {label}
        {sub && <span className="ml-1 text-xs text-text-faint">{sub}</span>}
      </dt>
      <dd className={strong ? "font-semibold" : "text-text-muted"}>{value}</dd>
    </div>
  );
}
