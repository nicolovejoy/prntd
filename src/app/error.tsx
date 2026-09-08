"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  ERROR_BOUNDARY_TITLE,
  ERROR_BOUNDARY_RETRY,
  ERROR_BOUNDARY_HOME,
} from "@/lib/action-copy";

/**
 * Route-segment error boundary for everything under src/app. Before this
 * file existed there was none anywhere in the tree, so a transient Turso
 * blip on any server-rendered page was a bare Next 500.
 *
 * error.js does not wrap the layout.js in its own segment, so the root
 * layout — and with it SiteHeader — still renders around this. The home
 * link is a backstop for a reader who does not read the header as
 * navigation; it points at "/" and not "/studio" because /studio is behind
 * sign-in and this screen is reachable signed out.
 *
 * Logging is console.error only: src/instrumentation.ts's onRequestError
 * already writes the app_error row that /admin/errors reads, and a second
 * write from the client would double-count it.
 */
export default function Error({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // Both are supplied by Next 16.2. They are typed optional so that a
  // future rename of the unstable_ prop cannot turn the click handler into
  // `undefined()` at runtime — see the ?? below.
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <div role="alert" className="space-y-6 border border-border p-6">
        {/* The thrown message is a digest in production, so the reader gets
            our sentence, not the server's. */}
        <h1 className="text-sm font-medium text-foreground">
          {ERROR_BOUNDARY_TITLE}
        </h1>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            onClick={() => (unstable_retry ?? reset)?.()}
            className="min-h-11"
          >
            {ERROR_BOUNDARY_RETRY}
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline"
          >
            {ERROR_BOUNDARY_HOME}
          </Link>
        </div>
        {error.digest && (
          <p
            data-testid="error-digest"
            className="font-mono text-[11px] leading-4 text-text-faint"
          >
            {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
