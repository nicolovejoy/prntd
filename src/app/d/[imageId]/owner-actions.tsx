import { MONO_LABEL } from "./identity-block";
import { PublishCta } from "./publish-cta";
import { UnpublishAction } from "./unpublish-action";
import { ConversationActions } from "./conversation-actions";

/**
 * The owner's actions in one labelled group (design review: "the owner
 * branch stacks seven small links … with no grouping"; the verdict is
 * "everything else in a small-text action row"). Server component; each
 * action inside is its own client island so the page stays mostly static.
 *
 * The publish state is stated as a value ("Not published") rather than
 * inferred from which button is present.
 */
export function OwnerActions({
  imageId,
  imageUrl,
  isPublished,
  canPublish,
  sourceDesignId,
  conversationArchived,
}: {
  imageId: string;
  imageUrl: string;
  isPublished: boolean;
  /** A real (non-anonymous) session; publishImage rejects guests server-side too. */
  canPublish: boolean;
  /** Null when the conversation this image came from no longer resolves — an
   * image pinned by an order or a seed outlives its thread. */
  sourceDesignId: string | null;
  conversationArchived: boolean;
}) {
  return (
    <section className="border-t border-border pt-3">
      <h2 className={MONO_LABEL}>Owner</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
        {isPublished ? (
          <UnpublishAction imageId={imageId} />
        ) : (
          <>
            <span className="text-sm text-text-faint">Not published</span>
            <PublishCta
              imageId={imageId}
              imageUrl={imageUrl}
              canPublish={canPublish}
            />
          </>
        )}
        {sourceDesignId && (
          <ConversationActions
            designId={sourceDesignId}
            archived={conversationArchived}
          />
        )}
      </div>
    </section>
  );
}
