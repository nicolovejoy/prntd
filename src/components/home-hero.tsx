"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui";

type RecentDesign = {
  id: string;
  currentImageUrl: string | null;
  generationCount: number;
  status: string;
};

export function HomeHero({
  getRecentDesigns,
}: {
  getRecentDesigns: () => Promise<RecentDesign[]>;
}) {
  const { data: session } = authClient.useSession();
  const [designs, setDesigns] = useState<RecentDesign[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (session) {
      getRecentDesigns()
        .then(setDesigns)
        .finally(() => setLoaded(true));
    }
  }, [session, getRecentDesigns]);

  // Logged-out: landing hero
  if (!session) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="max-w-2xl text-center space-y-6">
          <h1 className="text-5xl font-bold tracking-tight">
            Design a shirt with AI
          </h1>
          <p className="text-xl text-text-muted max-w-lg mx-auto">
            Describe your idea. AI generates an image. Ask for changes, then
            order a shirt.
          </p>
          <Link href="/design">
            <Button size="lg">Start Designing</Button>
          </Link>
        </div>
      </main>
    );
  }

  // Logged-in: personal hero
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
                : "Create your first shirt design."}
            </p>
          </div>
          <Link href="/design">
            <Button>New Design</Button>
          </Link>
        </div>

        {/* Recent designs */}
        {hasDesigns && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-text-muted">
                Recent designs
              </h2>
              <Link href="/designs">
                <Button variant="secondary" size="sm">
                  View All Designs
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {designs.slice(0, 4).map((design) => (
                <Link
                  key={design.id}
                  href={
                    design.status === "draft"
                      ? `/design?id=${design.id}`
                      : `/preview?id=${design.id}`
                  }
                  className="group"
                >
                  <div className="aspect-square rounded-lg border border-border bg-checkerboard overflow-hidden flex items-center justify-center group-hover:border-border-hover transition-colors">
                    {design.currentImageUrl ? (
                      <img
                        src={design.currentImageUrl}
                        alt="Design"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-text-faint text-xs">
                        No image yet
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
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
