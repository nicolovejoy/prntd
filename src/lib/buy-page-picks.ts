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
import { ACTIVE_BLANKS } from "@/lib/blanks";
import type { PlacementPick } from "@/lib/placement-pins";

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
  // Size and colour validate against the product the link names. With no
  // product (or a discontinued one) the winner is not known here: it may be
  // the viewer's remembered product, which only the panel can see. So a pick
  // is kept when ANY active blank offers it, and the panel re-validates it
  // against the product that wins (`resolveProductAndSize`,
  // `resolveDefaultColor`).
  const candidates = blank ? [blank] : ACTIVE_BLANKS;
  const size = first(search, "size");
  const color = first(search, "color");
  const back = id(search, "back");
  return {
    order: first(search, "order") === "1",
    product: blank ? blank.id : null,
    size: size && candidates.some((b) => b.sizes.includes(size)) ? size : null,
    color:
      color && candidates.some((b) => b.colors.some((c) => c.name === color))
        ? color
        : null,
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

/** A raw query value as an image or design id, or null: the rule `back` and
 * `line` use, for callers outside the pick set (the `/preview` redirect's
 * `id` and `front`). */
export function parseIdParam(raw: string | string[] | undefined): string | null {
  return id({ value: raw }, "value");
}

/**
 * The buy panel's picks while it is open, as the page's other links need them
 * (#278 slice 4); null while it is collapsed. Reported by the panel through
 * `buy-panel-picks-context.tsx`.
 */
export type OpenBuyPanelPicks = {
  product: string;
  size: string | null;
  color: string;
  back: string | null;
  swap: boolean;
} | null;

/**
 * Link from the image detail page to another image of the same conversation.
 * While the panel is open it carries the panel's picks, so switching the image
 * keeps product, size and colour: this replaces `/preview`'s front picker
 * (Nico, 2026-10-01: no utility lost). The back and the swap ride along unless
 * the sibling IS the back image, where they are dropped. Collapsed, it is the
 * plain link.
 */
export function siblingImageHref(
  siblingId: string,
  open: OpenBuyPanelPicks,
  from?: string | null
): string {
  if (!open) return buyPageHref(siblingId, { from: from ?? null });
  const keepBack = open.back !== null && open.back !== siblingId;
  return buyPageHref(siblingId, {
    order: true,
    product: open.product,
    size: open.size,
    color: open.color,
    back: keepBack ? open.back : null,
    swap: keepBack && open.swap,
    from: from ?? null,
  });
}

/**
 * The conversation page's Order (#278 slice 4): the image detail page of the
 * image shown at `imageUrl` (the conversation page tracks images by URL), with
 * the panel open and, for a product-version link, that product. Null when the
 * URL names no image in the list. `from=/studio`: the conversation page hangs
 * off the Studio, and the image page's back arrow returns there.
 */
export function conversationOrderHref(
  images: ReadonlyArray<{ id: string; url: string }>,
  imageUrl: string | null,
  productId?: string
): string | null {
  if (!imageUrl) return null;
  const image = images.find((img) => img.url === imageUrl);
  if (!image) return null;
  return buyPageHref(image.id, {
    order: true,
    product: productId ?? null,
    from: "/studio",
  });
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

/** What the page hands `BuyHero` / `BuyPanel` as `initialPicks`. */
export type BuyPanelInitialPicks = {
  expanded: boolean;
  productId: string | null;
  size: string | null;
  color: string | null;
  back: PlacementPick | null;
  swapped: boolean;
};

/**
 * The back image id the page should ask the server to resolve, or null when
 * the link's `back` must not even be looked up: the viewer may not order the
 * page image (`buyable`: it is published, or it is the viewer's own
 * unpublished image; the page takes this from the server's `canOrder`), the
 * viewer is not a signed-in real user, back designs are off, or the link has
 * none. The server (`resolveInitialBack`) re-checks all of it; this keeps the
 * lookup from running for a viewer who could never use the answer.
 */
export function backToResolve(
  picks: BuyPagePicks,
  gate: { buyable: boolean; loggedIn: boolean; multiPlacement: boolean }
): string | null {
  return gate.buyable && gate.loggedIn && gate.multiPlacement
    ? picks.back
    : null;
}

/**
 * The panel's starting picks from the parsed link and the server's answer on
 * the back (`null` when it was not asked, or refused). `swapped` needs a back
 * that resolved and is not the page's own image (swapping an image with itself
 * changes nothing).
 */
export function buildInitialPicks(
  picks: BuyPagePicks,
  initialBack: PlacementPick | null,
  pageImageId: string
): BuyPanelInitialPicks {
  return {
    expanded: picks.order,
    productId: picks.product,
    size: picks.size,
    color: picks.color,
    back: initialBack,
    swapped: picks.swap && !!initialBack && initialBack.id !== pageImageId,
  };
}
