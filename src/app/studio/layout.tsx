import { StudioTabs } from "@/components/studio-tabs";

/**
 * One frame for the Studio's two views (nav model A): the bench and the
 * library. The heading and the tab strip live here rather than on each page,
 * so they cannot disagree about what they are called or how you get between
 * them — that disagreement was the "five surfaces claim my work" problem
 * this slice exists to fix. (A third view, Archive, existed until
 * 2026-09-09 — dropped once Library's Active/All filter (#238) already
 * covered it; `/studio/archive` now 308s to `/studio/library`.)
 *
 * The pages own their own auth gate (requireStudioUser, which admits a
 * guest-funnel session while the guest funnel is on, #241); a layout renders
 * before that resolves, but the strip is static links, so there is nothing
 * here to leak. For the same reason the guest sign-up line lives in the
 * pages, not here: it depends on the session, and a layout does not
 * re-render on navigation.
 */
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-4 sm:px-6 pt-6 max-w-4xl mx-auto w-full">
        <h1 className="text-xl sm:text-2xl font-bold mb-4">Studio</h1>
        <StudioTabs />
      </div>
      {children}
    </div>
  );
}
