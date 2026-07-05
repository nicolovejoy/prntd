"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui";

type RecentDesign = {
  id: string;
  imageUrl: string | null;
  generationCount: number;
  status: string;
};

export function HomeHero({
  getRecentDesigns,
}: {
  getRecentDesigns: () => Promise<RecentDesign[]>;
}) {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const [designs, setDesigns] = useState<RecentDesign[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getRecentDesigns()
      .then((d) => { if (!cancelled) setDesigns(d); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Signed-in personal hero only — the page renders <MakerHero> for
  // signed-out visitors (server-side session branch, no client flash).
  const hasDesigns = loaded && designs.length > 0;

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full space-y-10">
        {/* CTA row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {hasDesigns ? "Welcome back" : "Get started"}
            </h1>
            <p className="text-text-muted mt-1">
              {hasDesigns
                ? "Continue a design or start fresh."
                : "Make your first design."}
            </p>
          </div>
          <Link href="/design">
            <Button>New Design</Button>
          </Link>
        </div>

        {/* Own designs live under "My Designs" nav; surfaced here only as a
            link, not a grid (homepage leads with the community feed). */}
        {hasDesigns && (
          <div>
            <Link href="/designs">
              <Button variant="secondary" size="sm">
                View All Designs
              </Button>
            </Link>
          </div>
        )}

        {/* Quick start for new users */}
        {loaded && !hasDesigns && (
          <div className="text-center py-12 border border-border rounded-lg">
            <p className="text-text-muted mb-4">
              Describe what you want. Chat to refine. Generate when ready.
            </p>
            <Link href="/design">
              <Button>Start your first design</Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
