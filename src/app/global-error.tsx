"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Root-layout error boundary. Replaces the root layout when active, so it
 * has to supply its own <html>/<body> and its own styles — hence the
 * globals.css import (Next dedupes it with the root layout's).
 *
 * The font CSS variables are set on the root layout's <html>, which by
 * definition did not render if this is showing, so the body falls back to
 * the stack globals.css declares. Accepted: this is a crash screen.
 *
 * No metadata export is possible in a client component; a crash screen does
 * not need a title. Copy and behaviour mirror src/app/error.tsx.
 */
export default function GlobalError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="mx-auto w-full max-w-2xl px-4 py-16">
          <div className="space-y-6 border border-border p-6">
            <p className="text-sm text-foreground">
              Something went wrong loading this page.
            </p>
            <button
              type="button"
              onClick={() => (unstable_retry ?? reset)?.()}
              className="min-h-11 rounded-md border border-foreground bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-well"
            >
              Try again
            </button>
            {error.digest && (
              <p
                data-testid="global-error-digest"
                className="font-mono text-[11px] leading-4 text-text-faint"
              >
                {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
