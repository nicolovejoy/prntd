"use client";

import { useState } from "react";
import { openConversation } from "@/app/d/conversation-actions";
import { deleteDesign } from "@/app/designs/actions";
import { DELETE_CONVERSATION_CONFIRM } from "@/lib/design-view";
import { useConfirm } from "@/components/ui";

/**
 * The owner's two conversation-level controls on the image detail page
 * (studio-plan slice 5). My Designs is a grid of images now, so this page is
 * where a conversation is reached from — and, since the card that used to
 * carry Delete is gone, where it is deleted from.
 *
 * "Open conversation" reopens the thread first when it has archived out of
 * the Studio, so the link always lands on a writable conversation rather than
 * a read-only record with no explanation.
 */
export function ConversationActions({
  designId,
  archived,
}: {
  designId: string;
  /** Source conversation is closed — opening it reopens it first. */
  archived: boolean;
}) {
  const [busy, setBusy] = useState<"open" | "delete" | null>(null);
  const { confirm, element: confirmSheet } = useConfirm();

  async function open() {
    setBusy("open");
    try {
      await openConversation(designId);
      window.location.assign(`/design?id=${designId}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Action failed");
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this conversation?",
      body: DELETE_CONVERSATION_CONFIRM,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    try {
      // Expected refusals come back as { error } — prod masks thrown
      // server-action messages, so a throw here only shows the digest.
      const result = await deleteDesign(designId);
      if (result?.error) {
        window.alert(result.error);
        setBusy(null);
        return;
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
      return;
    }
    // This page's image is usually gone with the conversation — and when it
    // survives (order/seed/cart reference) the library is still where the
    // user should land.
    window.location.assign("/designs");
  }

  return (
    <div className="flex flex-wrap items-center gap-4 pt-1">
      {confirmSheet}
      {/* Text buttons, min-h-11 for the 44px phone tap target. */}
      <button
        type="button"
        onClick={open}
        disabled={busy !== null}
        data-testid="open-conversation"
        className="inline-flex items-center min-h-11 text-sm text-text-muted underline hover:no-underline disabled:opacity-50"
      >
        {busy === "open" ? "Opening…" : "Open conversation"}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy !== null}
        className="inline-flex items-center min-h-11 text-sm text-text-faint underline hover:no-underline disabled:opacity-50"
      >
        {busy === "delete" ? "Deleting…" : "Delete conversation"}
      </button>
      {archived && (
        <span className="text-sm text-text-faint">
          Archived — opening brings it back to the Studio.
        </span>
      )}
    </div>
  );
}
