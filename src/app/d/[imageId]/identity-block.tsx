import Link from "next/link";
import { EditableNaming } from "./editable-naming";

/**
 * The mono label used across the image detail page for section and row
 * labels (Paper slice 5, #188). Defined once here so the page, the buy
 * panel, the owner row and the siblings strip cannot drift apart.
 */
export const MONO_LABEL =
  "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";

type ForkLink = {
  imageId: string;
  title: string | null;
  designerName: string;
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 sm:flex-row sm:gap-4 sm:py-2">
      <dt className={`${MONO_LABEL} sm:w-32 sm:shrink-0 sm:pt-0.5`}>{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Title, designer and price as one labelled block (design review,
 * "/d/[imageId] image page": "title/designer/price as one mono-labelled
 * block"). Server component — the only client island inside it is the
 * owner's title editor.
 *
 * `priceFloor` is the ITEM price floor (minRetailPrice), so the value reads
 * "From $19.43" and says nothing about delivery: flat shipping is a separate
 * Stripe line and is broken out in the expanded buy panel. PR #214 deleted
 * the landing's "From $19.43, shipped." for claiming otherwise — do not add
 * "shipped", "delivered" or a shipping tail here.
 */
export function IdentityBlock({
  imageId,
  title,
  canEditTitle,
  designerName,
  priceFloor,
  forkChain,
}: {
  imageId: string;
  title: string | null;
  canEditTitle: boolean;
  designerName: string;
  priceFloor: number;
  forkChain: ForkLink[];
}) {
  return (
    <dl className="border-t border-border">
      <Row label="Title">
        <EditableNaming imageId={imageId} title={title} canEdit={canEditTitle} />
      </Row>
      <Row label="Designed by">{designerName}</Row>
      <Row label="Price">From ${priceFloor.toFixed(2)}</Row>
      {forkChain.length > 0 && (
        <Row label="Forked from">
          <span className="text-text-muted">
            {forkChain.map((link, i) => (
              <span key={link.imageId}>
                {i > 0 && " ← "}
                <Link
                  href={`/d/${link.imageId}`}
                  className="underline underline-offset-[3px] text-foreground hover:text-text-muted"
                >
                  {link.title ?? "an earlier design"}
                </Link>{" "}
                by {link.designerName}
              </span>
            ))}
          </span>
        </Row>
      )}
    </dl>
  );
}
