"use client";

import { useState } from "react";
import { openConversation } from "@/app/d/conversation-actions";
import { deleteDesign } from "@/app/designs/actions";
import {
  DELETE_CONVERSATION_CONSEQUENCE,
  DELETE_CONVERSATION_TITLE,
} from "@/lib/design-view";
import { useConfirm, InlineNotice } from "@/components/ui";
import { DELETE_CONVERSATION_FAILED, OPEN_CONVERSATION_FAILED } from "@/lib/action-copy";

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
  const [error, setError] = useState<string | null>(null);
  const { confirm, element: confirmSheet } = useConfirm();

  async function open() {
    setBusy("open");
    setError(null);
    try {
      await openConversation(designId);
      window.location.assign(`/design?id=${designId}`);
    } catch {
      setError(OPEN_CONVERSATION_FAILED);
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: DELETE_CONVERSATION_TITLE,
      body: DELETE_CONVERSATION_CONSEQUENCE,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    setError(null);
    try {
      // Expected refusals come back as { error } — prod masks thrown
      // server-action messages, so a throw here only shows the digest. The
      // refusal is written for the reader, so it is shown verbatim; a throw
      // gets our own line.
      const result = await deleteDesign(designId);
      if (result?.error) {
        setError(result.error);
        setBusy(null);
        return;
      }
    } catch {
      setError(DELETE_CONVERSATION_FAILED);
      setBusy(null);
      return;
    }
    // This page's image is usually gone with the conversation — and when it
    // survives (order/seed/cart reference) the library is still where the
    // user should land.
    window.location.assign("/studio/library");
  }

  return (
    // `contents` so the two buttons become direct children of the OWNER row's
    // flex container and align with its other actions instead of forming a
    // nested block (Paper slice 5, #188).
    <div className="contents">
      {confirmSheet}
      {/* Text buttons, min-h-11 for the 44px phone tap target. */}
      <button
        type="button"
        onClick={open}
        disabled={busy !== null}
        data-testid="open-conversation"
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline sm:min-h-0"
      >
        {busy === "open" ? "Opening…" : "Open conversation"}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy !== null}
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline sm:min-h-0"
      >
        {busy === "delete" ? "Deleting…" : "Delete conversation"}
      </button>
      {archived && (
        <span className="text-sm text-text-faint">
          Archived — opening brings it back to the Studio.
        </span>
      )}
      <div className="basis-full">{error && <InlineNotice message={error} />}</div>
    </div>
  );
}
