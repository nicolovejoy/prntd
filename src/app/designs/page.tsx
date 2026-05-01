"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUserDesigns, deleteDesign, archiveDesign } from "./actions";
import { Badge, Button } from "@/components/ui";

type Design = Awaited<ReturnType<typeof getUserDesigns>>[number];


function getDesignHref(design: Design) {
  if (design.status === "ordered") return "/orders";
  return `/design?id=${design.id}`;
}

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function DesignsPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserDesigns()
      .then(setDesigns)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this design?")) return;
    await deleteDesign(id);
    setDesigns((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleArchive(id: string) {
    await archiveDesign(id);
    setDesigns((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">My Designs</h1>
          <Link href="/design">
            <Button size="sm">New Design</Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : designs.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <p className="text-gray-500 text-lg">No designs yet.</p>
            <Link href="/design">
              <Button>Start your first design</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {designs.map((design) => (
              <div key={design.id} className="border rounded-lg overflow-hidden group">
                <Link href={getDesignHref(design)} className="block">
                  <div className="aspect-square bg-checkerboard flex items-center justify-center">
                    {design.currentImageUrl ? (
                      <img
                        src={design.currentImageUrl}
                        alt="Design preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-gray-400 text-sm">No image yet</span>
                    )}
                  </div>
                </Link>
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant={design.status}>
                      {design.status}
                    </Badge>
                    <span className="text-xs text-gray-400">
                      {timeAgo(new Date(design.updatedAt))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {design.generationCount} generation{design.generationCount !== 1 ? "s" : ""}
                    </span>
                    {design.status === "ordered" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleArchive(design.id)}
                      >
                        Archive
                      </Button>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(design.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
