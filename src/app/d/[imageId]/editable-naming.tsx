"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePublishedNaming } from "@/app/designs/actions";
import { Button, InlineNotice } from "@/components/ui";
import { SAVE_TITLE_FAILED } from "@/lib/action-copy";

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

  // A blank title is unsaveable (the server refuses it), so the control says
  // so rather than letting the tap fail. The dotted-border disabled look
  // comes from the Button primitive.
  const blank = titleDraft.trim() === "";

  if (!editing) {
    return (
      <div className="flex items-baseline gap-3">
        {/* 14px/500 ink: the title is a value inside the identity block
            now, not a page-scale headline (Paper slice 5, #188). It stays
            the page's h1. Rendered unconditionally — an owner viewing an
            unpublished, untitled image (canEdit false there) still gets a
            labelled TITLE row, falling back to "Untitled". */}
        <h1 className="text-sm font-medium text-foreground">
          {title?.trim() || "Untitled"}
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
    );
  }

  async function handleSave() {
    if (blank) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updatePublishedNaming(imageId, { title: titleDraft });
      // A structured refusal crosses the wire as data and is already written
      // for the reader, so it is shown verbatim — unlike a thrown error,
      // which production masks behind a digest.
      if (result?.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError(SAVE_TITLE_FAILED);
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
        className="w-full bg-surface border border-border rounded px-3 py-2 text-base"
      />
      {error && <InlineNotice message={error} />}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || blank} size="sm">
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
