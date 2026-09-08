"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Root-layout error boundary. Replaces the root layout when active, so it
 * has to supply its own <html>/<body> and its own styles — hence the
 * globals.css import (Next dedupes it with the root layout's).
 *
 * The font CSS variables (`--font-geist-sans`, `--font-geist-mono`) are set
 * by the root layout's <html> className, which by definition did not render
 * if this is showing — they are undefined here. `globals.css`'s
 * `font-family: var(--font-geist-sans), Arial, …` does NOT fall back to
 * Arial in that case: a var() referencing an undefined custom property with
 * no inline fallback makes the whole declaration invalid at computed-value
 * time, so font-family falls back to the browser default (serif on most),
 * never reaching the Arial/monospace tail. Named explicitly below via inline
 * style instead, because the digest — a case-sensitive hex string an admin
 * matches against /admin/errors — is exactly where a proportional serif
 * blurs 0/O and l/1.
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
      <body
        className="bg-background text-foreground"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <main className="mx-auto w-full max-w-2xl px-4 py-16">
          <div role="alert" className="space-y-6 border border-border p-6">
            <h1 className="text-sm font-medium text-foreground">
              Something went wrong loading this page.
            </h1>
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
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
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
