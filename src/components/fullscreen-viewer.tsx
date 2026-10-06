"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ViewerOption = { key: string; label: string };

const FOCUSABLE =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const LABEL_CLASS =
  "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase";

/**
 * A plain full-window viewer for one image (#285). It is a shell: the caller
 * passes what to enlarge as children, which fill the content box. Used by the
 * image detail page (artwork, and the shirt mockup with its Front/Back
 * switch) and by the checkout page's order summary. The Studio's
 * `ImageLightbox` is a different thing (an image navigator with actions) and
 * is not touched.
 *
 * - Portaled to `document.body`, so no transformed or clipped ancestor can
 *   change what `fixed` is measured against. It renders only after a tap, so
 *   `document` is always there.
 * - Escape closes, with `preventDefault` so `Breadcrumbs`' Escape-to-go-up
 *   skips the keystroke (both listen on `window`).
 * - A tap anywhere closes, except on a button or link (the switch, Close, a
 *   Retry inside the content). Phones leave almost no backdrop.
 * - Focus lands on Close, Tab wraps inside, focus that escapes is pulled
 *   back, and the opener gets focus again on close.
 * - Body scroll is locked while open and the previous inline value restored.
 * - Pinch-zoom is left alone: no `touch-action`, and nothing here calls
 *   `preventDefault` on touch or wheel events.
 * - It never reads or writes the URL or history.
 *
 * The image is shown larger, not sharper: mockups are fixed-size renders from
 * Printful, and zooming past their native pixels is upscaling. Measured sizes
 * (#285, Task 1): not measured.
 */
export function FullscreenViewer({
  label,
  onClose,
  options,
  activeKey,
  onSelect,
  children,
}: {
  label: string;
  onClose: () => void;
  options?: ViewerOption[];
  activeKey?: string;
  onSelect?: (key: string) => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  // Set while the opener is being handed focus back during teardown, so the
  // focus-containment listener (still attached until the passive cleanups
  // run) does not pull focus straight back onto Close.
  const restoring = useRef(false);

  // Captured in a LAYOUT effect so it runs before the passive "focus Close"
  // effect below (all layout effects run before any passive effect); a
  // passive capture would record Close itself.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    restoring.current = false;
    return () => {
      const el = opener.current;
      restoring.current = true;
      if (el instanceof HTMLElement && document.contains(el)) el.focus();
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const nodes = Array.from(
          dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (!dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (
        options &&
        options.length > 1 &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight")
      ) {
        const i = options.findIndex((o) => o.key === activeKey);
        const j = e.key === "ArrowLeft" ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < options.length) {
          e.preventDefault();
          onSelect?.(options[j].key);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, options, activeKey, onSelect]);

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (restoring.current) return;
      const target = e.target as Node | null;
      if (target && dialogRef.current && !dialogRef.current.contains(target)) {
        closeRef.current?.focus();
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const showSwitch = !!options && options.length > 1;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="fullscreen-viewer"
      className="fixed inset-0 z-[60] flex flex-col overscroll-contain bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onClick={(e) => {
        if ((e.target as Element).closest("button, a")) return;
        onClose();
      }}
    >
      <div className="flex items-center justify-between gap-3 p-2">
        {showSwitch ? (
          <div role="group" aria-label="View" className="flex">
            {options!.map((o, i) => {
              const active = o.key === activeKey;
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={active}
                  data-testid={`fullscreen-viewer-option-${o.key}`}
                  onClick={() => onSelect?.(o.key)}
                  className={`min-h-11 min-w-11 border border-foreground px-4 ${LABEL_CLASS} ${
                    i > 0 ? "-ml-px" : ""
                  } ${
                    active
                      ? "bg-foreground text-background"
                      : "bg-background text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          data-testid="fullscreen-viewer-close"
          className={`min-h-11 min-w-11 border border-foreground bg-background px-4 text-foreground ${LABEL_CLASS}`}
        >
          Close
        </button>
      </div>
      <div
        data-testid="fullscreen-viewer-content"
        className="relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden border border-border"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
