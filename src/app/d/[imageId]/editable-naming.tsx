"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePublishedNaming } from "@/app/designs/actions";
import { Button } from "@/components/ui";

type Props = {
  imageId: string;
  title: string | null;
  canEdit: boolean;
};

export function EditableNaming({ imageId, title, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <>
        {(title || canEdit) && (
          <div className="flex items-baseline gap-3">
            {/* 14px/500 ink: the title is a value inside the identity block
                now, not a page-scale headline (Paper slice 5, #188). It stays
                the page's h1. */}
            <h1 className="text-sm font-medium text-foreground">
              {title ?? "Untitled"}
            </h1>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="min-h-11 text-xs text-text-muted underline underline-offset-[3px] hover:no-underline sm:min-h-0"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updatePublishedNaming(imageId, { title: titleDraft });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 pt-2">
      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        placeholder="Title"
        maxLength={80}
        className="w-full bg-surface border border-border rounded px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-negative">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          onClick={() => {
            setEditing(false);
            setTitleDraft(title ?? "");
            setError(null);
          }}
          variant="ghost"
          size="sm"
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
