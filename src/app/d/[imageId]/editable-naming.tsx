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
            <h1 className="text-xl sm:text-2xl font-bold">{title ?? "Untitled"}</h1>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-text-muted underline hover:no-underline"
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
        className="w-full bg-surface border border-border rounded px-3 py-2 text-2xl font-bold"
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
