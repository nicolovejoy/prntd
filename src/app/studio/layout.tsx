import { StudioTabs } from "@/components/studio-tabs";

/**
 * One frame for the Studio's three views (nav model A). The heading and the
 * tab strip live here rather than on each page, so the bench, the library and
 * the archive cannot disagree about what they are called or how you get
 * between them — that disagreement was the "five surfaces claim my work"
 * problem this slice exists to fix.
 *
 * The pages own their own auth gate (requireRealUser); a layout renders
 * before that resolves, but the strip is static links, so there is nothing
 * here to leak.
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
