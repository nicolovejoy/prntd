"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unpublishImage } from "@/app/designs/actions";
import { useConfirm } from "@/components/ui";

/**
 * Take a published design back down. Lifted out of
 * published-image-view.tsx in Paper slice 5 (#188): that component only
 * renders while the hero is collapsed, so Un-publish used to vanish the
 * moment the buyer tapped Order. It belongs with the owner's other actions.
 *
 * The confirm copy and the post-action redirect are unchanged.
 */
export function UnpublishAction({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, element: confirmSheet } = useConfirm();

  async function unpublish() {
    const ok = await confirm({
      title: "Take this design down from the storefront?",
      body: "You can re-publish it later.",
      confirmLabel: "Un-publish",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await unpublishImage(imageId);
      // The page is no longer public — send the owner back to their library.
      router.push("/studio/library");
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
