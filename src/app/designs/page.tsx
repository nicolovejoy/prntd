"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getUserDesigns,
  deleteDesign,
  archiveDesign,
  publishImage,
} from "./actions";
import { forkImage } from "../d/actions";
import { Badge, Button } from "@/components/ui";

type Design = Awaited<ReturnType<typeof getUserDesigns>>[number];


function getDesignHref(design: Design) {
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
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getUserDesigns()
      .then(setDesigns)
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : String(err))
      )
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

  async function handlePublish(designId: string, imageId: string) {
    setBusy(designId);
    try {
      await publishImage(imageId);
      const fresh = await getUserDesigns();
      setDesigns(fresh);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleFork(designId: string, imageId: string) {
    setBusy(designId);
    try {
      const newId = await forkImage(imageId);
      router.push(`/design?id=${newId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
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
        ) : loadError ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-red-400 font-medium">Failed to load designs.</p>
            <p className="text-xs text-text-muted font-mono">{loadError}</p>
          </div>
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
                    {design.imageUrl ? (
                      <img
                        src={design.imageUrl}
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
                      <div className="flex items-center gap-2">
                        <Link href={`/preview?id=${design.id}`}>
                          <Button size="sm">Reorder</Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchive(design.id)}
                        >
                          Archive
                        </Button>
                      </div>
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
                  {design.primaryImageId && (
                    <div className="flex items-center gap-2 pt-1 border-t border-border">
                      {design.primaryImagePublishedAt ? (
                        <Link
                          href={`/d/${design.primaryImageId}`}
                          className="text-xs text-text-muted underline hover:no-underline"
                        >
                          Published →
                        </Link>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy === design.id}
                          onClick={() =>
                            handlePublish(design.id, design.primaryImageId!)
                          }
                        >
                          {busy === design.id ? "Publishing…" : "Publish"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === design.id}
                        onClick={() =>
                          handleFork(design.id, design.primaryImageId!)
                        }
                      >
                        Fork
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
