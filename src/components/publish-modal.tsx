"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button } from "@/components/ui";
import { BackgroundPicker } from "@/components/background-picker";
import { DEFAULT_PUBLISH_BACKGROUND } from "@/lib/blanks";
import { publishImage } from "@/app/designs/actions";

/**
 * Publish flow modal (#16). Replaces auto-publish: the owner sets name,
 * description, and storefront backdrop before the design goes live, then
 * lands on its public page. Name/description left blank are auto-generated
 * by Claude (publishImage fills the gaps), so it's optional friction.
 */
export function PublishModal({
  imageId,
  open,
  onClose,
  from,
}: {
  /** Image to publish; null while the modal is closed. */
  imageId: string | null;
  open: boolean;
  onClose: () => void;
  /** Origin recorded on the destination link so its "up"/Escape returns here. */
  from?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bg, setBg] = useState<string>(DEFAULT_PUBLISH_BACKGROUND);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!imageId) return;
    setPublishing(true);
    setError(null);
    try {
      await publishImage(imageId, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        backgroundColor: bg,
      });
      const suffix = from ? `?from=${encodeURIComponent(from)}` : "";
      router.push(`/d/${imageId}${suffix}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPublishing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={publishing ? () => {} : onClose}
      className="w-[calc(100vw-2rem)] max-w-lg bg-background border border-border rounded-lg p-5 max-h-[90vh] overflow-y-auto"
    >
      <h2 className="text-lg font-bold">Publish to the Shop</h2>
      <p className="text-sm text-text-muted mt-1">
        Set how your design appears in the storefront. Leave name or
        description blank to auto-generate them.
      </p>

      <div className="space-y-4 mt-4">
        <div>
          <label className="block text-sm font-medium mb-2">Name</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-generated if blank"
            maxLength={80}
            className="w-full bg-surface border border-border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Auto-generated if blank"
            maxLength={400}
            rows={3}
            className="w-full bg-surface border border-border rounded px-3 py-2"
          />
        </div>
        <BackgroundPicker value={bg} onChange={setBg} disabled={publishing} />
      </div>

      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

      <div className="flex gap-2 mt-5">
        <Button onClick={confirm} disabled={publishing} className="flex-1">
          {publishing ? "Publishing…" : "Publish"}
        </Button>
        <Button
          onClick={onClose}
          variant="ghost"
          disabled={publishing}
        >
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
