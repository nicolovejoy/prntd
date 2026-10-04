/**
 * The image detail page's buy-panel picks as a query string (#278). The one
 * place that knows the parameter names: the page parses with
 * `parseBuyPagePicks`, the panel keeps the address bar in step with
 * `withBuyPagePicks`, and every link into the panel (sign-in return, Stripe
 * cancel, the cart's Edit) is built by `buyPageHref`.
 *
 * Parsing validates against the catalog only. Whether a `back` image may be
 * printed for this viewer is a server decision (`resolveInitialBack`), not
 * made here. No DB access.
 */
import { ACTIVE_BLANKS, DEFAULT_BLANK_ID, getBlankOrThrow } from "@/lib/blanks";

export type BuyPagePicks = {
  order: boolean;
  product: string | null;
  size: string | null;
  color: string | null;
  back: string | null;
  swap: boolean;
  line: string | null;
};

type Search = Record<string, string | string[] | undefined>;

// Image and cart-line ids are UUIDs; legacy image ids are short slugs.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function first(search: Search, key: string): string | null {
  const raw = search[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value : null;
}

function id(search: Search, key: string): string | null {
  const value = first(search, key);
  return value && ID_RE.test(value) ? value : null;
}

export function parseBuyPagePicks(search: Search): BuyPagePicks {
  const urlProduct = first(search, "product");
  const blank = ACTIVE_BLANKS.find((b) => b.id === urlProduct);
  // Size and colour validate against the product the link names, or the
  // default blank when it names none (or a discontinued one). The panel
  // re-validates against a remembered product if that wins.
  const palette = blank ?? getBlankOrThrow(DEFAULT_BLANK_ID);
  const size = first(search, "size");
  const color = first(search, "color");
  const back = id(search, "back");
  return {
    order: first(search, "order") === "1",
    product: blank ? blank.id : null,
    size: size && palette.sizes.includes(size) ? size : null,
    color: color && palette.colors.some((c) => c.name === color) ? color : null,
    back,
    swap: !!back && first(search, "swap") === "1",
    line: id(search, "line"),
  };
}

const PICK_KEYS = ["order", "product", "size", "color", "back", "swap", "line"] as const;

function setPicks(params: URLSearchParams, picks: Partial<BuyPagePicks>) {
  for (const key of PICK_KEYS) {
    if (!(key in picks)) continue;
    const value = picks[key];
    if (value === true) params.set(key, "1");
    else if (typeof value === "string" && value) params.set(key, value);
    else params.delete(key);
  }
}

/** A link to the image detail page with the given picks. */
export function buyPageHref(
  imageId: string,
  picks: Partial<BuyPagePicks> & { from?: string | null }
): string {
  const params = new URLSearchParams();
  setPicks(params, picks);
  if (picks.from) params.set("from", picks.from);
  const qs = params.toString();
  return qs ? `/d/${imageId}?${qs}` : `/d/${imageId}`;
}

/** `search` with the pick params replaced; other params (`from`) are kept. */
export function withBuyPagePicks(
  search: string,
  picks: Partial<BuyPagePicks>
): string {
  const params = new URLSearchParams(search);
  // Rebuild so pick params always follow the non-pick ones in a fixed order.
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    if (!(PICK_KEYS as readonly string[]).includes(key)) kept.append(key, value);
  }
  const current: Partial<BuyPagePicks> = {};
  for (const key of PICK_KEYS) {
    const value = params.get(key);
    if (value === null) continue;
    if (key === "order" || key === "swap") current[key] = value === "1";
    else current[key] = value;
  }
  setPicks(kept, { ...current, ...picks });
  const qs = kept.toString();
  return qs ? `?${qs}` : "";
}
