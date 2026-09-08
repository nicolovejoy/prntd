import Link from "next/link";
import { EditableNaming } from "./editable-naming";
import { MONO_LABEL } from "./mono-label";

// Re-exported so any existing `from "./identity-block"` import keeps
// working; the client components on this page import it from
// `./mono-label` directly (see that module's docblock for why).
export { MONO_LABEL } from "./mono-label";

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
      <dd className="text-sm text-foreground sm:flex-1 sm:min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Title and designer as one labelled block (design review, "/d/[imageId]
 * image page"). Server component — the only client island inside it is the
 * owner's title editor.
 *
 * No PRICE row, on purpose. The review asked for "title/designer/price";
 * the item floor ($19.43 before shipping) is a number nobody pays (shipping is a
 * separate line) and Nico removed it on 2026-09-08. The price appears once
 * the buyer has picked garment and size — in the expanded buy panel's total.
 */
export function IdentityBlock({
  imageId,
  title,
  canEditTitle,
  designerName,
  forkChain,
}: {
  imageId: string;
  title: string | null;
  canEditTitle: boolean;
  designerName: string;
  forkChain: ForkLink[];
}) {
  return (
    <dl className="border-t border-border">
      <Row label="Title">
        <EditableNaming imageId={imageId} title={title} canEdit={canEditTitle} />
      </Row>
      <Row label="Designed by">{designerName}</Row>
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
