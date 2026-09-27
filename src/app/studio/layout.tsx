/**
 * One frame for the Studio. The 2026-09-27 revision to nav model A
 * (docs/ux-design-review-2026-09.md) moved My Designs out to its own
 * top-level route (`/designs`), so the Studio is a single view now — the
 * bench — and this layout is just its heading. No bottom margin on the
 * `<h1>`: the bench's own `py-6` wrapper around the composer supplies the
 * 24px gap beneath it, the same 24px the bench had under the old tab strip.
 *
 * The page owns its own auth gate (requireStudioUser, which admits a
 * guest-funnel session while the guest funnel is on, #241); a layout renders
 * before that resolves, but the heading is static, so there is nothing here
 * to leak. The guest sign-up/sign-in line lives in the bench, not here: it
 * depends on the session and on whether any lane is on screen, and a layout
 * does not re-render on navigation.
 */
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-4 sm:px-6 pt-6 max-w-4xl mx-auto w-full">
        <h1 className="text-xl sm:text-2xl font-bold">Studio</h1>
      </div>
      {children}
    </div>
  );
}
