"use client";

import { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";

export type NoticeSheetProps = {
  open: boolean;
  title: string;
  body?: string;
  closeLabel?: string;
  onClose: () => void;
};

/**
 * One-button acknowledge sheet — ConfirmSheet's sibling for the case where
 * there is nothing to decide, only something to be told. Same Modal, same
 * chrome: slides up from the bottom under `sm:`, a centred dialog from `sm:`
 * up. Used where the failing control lives on a surface with no stable inline
 * slot (a lightbox, a drawer, a thread header); everything with a visible
 * anchor uses InlineNotice instead.
 *
 * role="alertdialog" rather than "dialog": the content is an error the user
 * is being asked to acknowledge, which is what that role means.
 */
export function NoticeSheet({
  open,
  title,
  body,
  closeLabel = "Close",
  onClose,
}: NoticeSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Close is the only action, so it is also the safe focus target: an
    // Enter keypress right after the sheet opens dismisses it.
    if (open) closeRef.current?.focus();
  }, [open]);

  const titleId = useId();

  return (
    <Modal open={open} onClose={onClose}>
      <div
        data-testid="notice-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 w-full rounded-t-xl border-t border-border bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:static sm:w-96 sm:rounded-xl sm:border sm:pb-5"
      >
        <h2 id={titleId} className="text-base font-medium text-foreground">{title}</h2>
        {body ? <p className="mt-2 text-sm text-text-muted">{body}</p> : null}
        <div className="mt-5 flex justify-end">
          <Button
            ref={closeRef}
            type="button"
            data-testid="notice-sheet-close"
            variant="secondary"
            size="lg"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={onClose}
          >
            {closeLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export type NoticeOptions = {
  title: string;
  body?: string;
  closeLabel?: string;
};

/**
 * Imperative notice() over the NoticeSheet primitive, so a caller can report
 * a failure from a catch block without wiring its own open/close state:
 *
 *   const { notice, element } = useNotice();
 *   catch { notice({ title, body }); }
 *   ...
 *   return <>{element}...</>;
 *
 * One notice at a time: a second call while one is open replaces it, so a
 * burst of failures never stacks sheets. Nothing is awaited — unlike
 * useConfirm there is no answer to wait for.
 */
export function useNotice(): { notice: (options: NoticeOptions) => void; element: ReactNode } {
  const [current, setCurrent] = useState<NoticeOptions | null>(null);

  const notice = useCallback((options: NoticeOptions) => {
    setCurrent(options);
  }, []);

  const dismiss = useCallback(() => setCurrent(null), []);

  const element = current ? (
    <NoticeSheet
      open
      title={current.title}
      body={current.body}
      closeLabel={current.closeLabel}
      onClose={dismiss}
    />
  ) : null;

  return { notice, element };
}
