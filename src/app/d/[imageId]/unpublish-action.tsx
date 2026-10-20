"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unpublishImage } from "@/app/designs/actions";
import { useConfirm } from "@/components/ui";
import { UNPUBLISH_UPLOAD_BODY, UNPUBLISH_UPLOAD_TITLE } from "@/lib/action-copy";

/**
 * Take a published design back down. Lifted out of
 * published-image-view.tsx in Paper slice 5 (#188): that component only
 * renders while the hero is collapsed, so Un-publish used to vanish the
 * moment the buyer tapped Order. It belongs with the owner's other actions.
 *
 * A design keeps its confirm copy and goes back to My Designs afterwards. An
 * uploaded photo (only one published before #357) gets its own confirm copy,
 * because it can't be re-published, and the owner stays on the page, which the
 * action's revalidatePath re-renders as "Not published" with no Publish
 * control (My Designs no longer lists uploads, so there is nothing to go back
 * to).
 */
export function UnpublishAction({
  imageId,
  isUpload = false,
}: {
  imageId: string;
  isUpload?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, element: confirmSheet } = useConfirm();

  async function unpublish() {
    const ok = await confirm({
      title: isUpload
        ? UNPUBLISH_UPLOAD_TITLE
        : "Take this design down from the storefront?",
      body: isUpload ? UNPUBLISH_UPLOAD_BODY : "You can re-publish it later.",
      confirmLabel: "Un-publish",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await unpublishImage(imageId);
      // A design goes back to My Designs. An upload stays: unpublishImage's
      // revalidatePath(`/d/${imageId}`) re-renders this page in the action's
      // response, so there is nothing more to do here.
      if (!isUpload) router.push("/designs");
    });
  }

  return (
    <>
      {confirmSheet}
      <button
        type="button"
        onClick={unpublish}
        disabled={pending}
        className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline disabled:cursor-not-allowed disabled:text-text-faint disabled:no-underline sm:min-h-0"
      >
        {pending ? "Un-publishing…" : "Un-publish"}
      </button>
    </>
  );
}
