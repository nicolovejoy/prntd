import Image from "next/image";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";
import { requireRealUser } from "@/lib/require-user";
import { getStudioArchiveData } from "@/lib/studio";
import { formatClosedDate } from "@/lib/studio-view";
import { reopenFromArchive } from "./actions";

/**
 * /studio/archive — the conversations that have left the Studio, newest
 * closed first (studio-plan slice 4). Both the 3-day sweep and the lane's own
 * Close land things here, and Reopen puts one back on the bench.
 *
 * A server component with a form per row: reopening is one write and one
 * navigation, so there is no client state worth hydrating for.
 */
export default async function StudioArchivePage() {
  const session = await requireRealUser();
  const conversations = await getStudioArchiveData(session.user.id);

  return (
    <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full">
      <Link
        href="/studio"
        className="text-sm text-text-muted hover:text-foreground transition-colors"
      >
        ← Studio
      </Link>
      <h1 className="text-xl sm:text-2xl font-bold mt-4 mb-1">Archive</h1>
      <p className="text-sm text-text-faint mb-6">
        Designs with no activity for three days leave the Studio.
      </p>

      {conversations.length === 0 ? (
        <EmptyState message="Nothing archived." />
      ) : (
        <ul className="divide-y divide-border" data-testid="archive-list">
          {conversations.map((conversation) => (
            <li
              key={conversation.designId}
              className="flex items-center gap-3 py-3"
              data-testid="archive-row"
            >
              <Link
                href={`/design?id=${conversation.designId}`}
                className="flex items-center gap-3 min-w-0 flex-1"
              >
                <div className="relative w-14 h-14 shrink-0 rounded-md overflow-hidden bg-checkerboard border border-border">
                  {conversation.heroImageUrl && (
                    <Image
                      src={conversation.heroImageUrl}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-contain"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm truncate">
                    {conversation.title ?? "Untitled"}
                  </p>
                  <p className="text-xs text-text-faint">
                    {formatClosedDate(conversation.closedAt)}
                  </p>
                </div>
              </Link>
              {/* One control per row, so the action is unambiguous on a
                  390px phone: the row opens the record, the button brings
                  it back to the bench. */}
              <form
                action={reopenFromArchive.bind(null, conversation.designId)}
                className="shrink-0"
              >
                {/* min-h-11 = 44px: the phone tap target, which `size="sm"`
                    (~26px) does not reach on its own. */}
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  className="min-h-11 px-4"
                >
                  Reopen
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
