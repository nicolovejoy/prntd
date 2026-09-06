"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";

export type ConfirmSheetProps = {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (danger button variant). */
  danger?: boolean;
  /** Disables both buttons while a caller's async action is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * House replacement for window.confirm (#195 — "looks shitty"). Phone-first:
 * slides up from the bottom as a sheet under `sm:`, a centred dialog from
 * `sm:` up. Built on Modal, which already handles the backdrop click and
 * Escape (preventDefault, so Breadcrumbs' Escape-to-go-up doesn't also
 * fire) — both map to onCancel here.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Cancel is the safe default focus target — an Enter keypress right
    // after the sheet opens should not accidentally confirm a destructive
    // action.
    if (open) cancelRef.current?.focus();
  }, [open]);

  const titleId = useId();

  return (
    <Modal open={open} onClose={onCancel}>
      <div
        data-testid="confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 w-full rounded-t-xl border-t border-border bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:static sm:w-96 sm:rounded-xl sm:border sm:pb-5"
      >
        <h2 id={titleId} className="text-base font-medium text-foreground">{title}</h2>
        {body ? <p className="mt-2 text-sm text-text-muted">{body}</p> : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            size="lg"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            data-testid="confirm-sheet-confirm"
            variant={danger ? "danger" : "primary"}
            size="lg"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

/**
 * Imperative confirm() over the ConfirmSheet primitive, so a caller can
 * `await` a yes/no answer instead of wiring its own open/resolve state:
 *
 *   const { confirm, element } = useConfirm();
 *   if (!(await confirm({ title, body }))) return;
 *   ...
 *   return <>{element}...</>;
 *
 * Only one prompt is shown at a time. Calling confirm() again while one is
 * still open resolves the earlier promise as `false` (treated as a cancel)
 * before showing the new prompt — a caller never has to track "is a sheet
 * already open" itself, and no promise is left hanging.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending((prev) => {
        prev?.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setPending((prev) => {
      prev?.resolve(result);
      return null;
    });
  }, []);

  // If the owning component unmounts while a sheet is open (e.g. an
  // optimistic action navigates away), resolve as false instead of leaving
  // the caller's await hanging forever. The ref is kept current in its own
  // effect (not during render — refs are for event handlers/effects only)
  // so the unmount cleanup below always resolves the latest pending prompt.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false);
    };
  }, []);

  const element = pending ? (
    <ConfirmSheet
      open
      title={pending.options.title}
      body={pending.options.body}
      confirmLabel={pending.options.confirmLabel}
      cancelLabel={pending.options.cancelLabel}
      danger={pending.options.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, element };
}
