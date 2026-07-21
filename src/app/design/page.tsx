"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  sendChatMessage,
  generateDesign,
  selectImage,
  deleteDesignImage,
  getDesign,
  getDesignChat,
  getDesignGallery,
  uploadReferenceImage,
} from "./actions";
import { PublishModal } from "@/components/publish-modal";
import type { ChatMessage } from "@/lib/db/schema";
import type { ChatOption } from "@/lib/ai";
import type { DesignImage, ProductVersionGroup } from "@/lib/design-images";
import { ChatPanel } from "./chat-panel";
import { ImageGallery } from "./image-gallery";
import { ImageLightbox } from "./image-lightbox";
import { MobileGalleryDrawer } from "./mobile-gallery-drawer";
import { MobileGalleryStrip } from "./mobile-gallery-strip";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { isDesignEmpty } from "@/lib/design-view";
import { createTurnTracker } from "@/lib/turn-tracker";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { readWarmedThread } from "@/lib/design-thread-cache";

export default function DesignPage() {
  return (
    <Suspense>
      <DesignPageInner />
    </Suspense>
  );
}

function DesignPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const designId = useRef(searchParams.get("id") ?? crypto.randomUUID());

  // #87 warm path: a card on /designs may have prefetched this thread. Hydrate
  // from the snapshot on first render to skip the empty-composer flash. This is
  // initial state ONLY — the resume effect below still revalidates fresh, so a
  // stale or absent snapshot never changes the final rendered thread. Read once
  // (lazy initializer) so a later warm can't retro-populate a live session.
  const [warmed] = useState(() => {
    const resumeId = searchParams.get("id");
    return resumeId ? readWarmedThread(resumeId) : undefined;
  });

  const [messages, setMessages] = useState<ChatMessage[]>(warmed?.chat ?? []);
  const [images, setImages] = useState<DesignImage[]>([]);
  const [productGroups, setProductGroups] = useState<ProductVersionGroup[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(
    warmed?.design?.displayImageUrl ?? null
  );
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [publishImageId, setPublishImageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Soft nudge: Generate/Compare dim until Claude judges the idea concrete
  // (subject + style). A design with existing renders starts ready.
  const [readyToGenerate, setReadyToGenerate] = useState(false);
  // Tappable quick-replies attached to the most recent assistant turn. Cleared
  // at the start of every new turn so chips never outlive the question.
  const [options, setOptions] = useState<ChatOption[]>([]);
  // #59: chat and generation turns register here. A settling action applies
  // its full effects (options/readiness/selection) only while it is still the
  // latest, un-cancelled turn — a cancelled generation's late completion may
  // append its image/message but never clobbers newer composer state.
  const turns = useRef(createTurnTracker());
  // Token of the in-flight generation (one at a time; handleGenerate refuses
  // re-entry). Null once it settles or the user cancels.
  const activeGeneration = useRef<number | null>(null);

  const refreshGallery = useCallback(async () => {
    const { sources, productGroups } = await getDesignGallery(designId.current);
    setReadyToGenerate(sources.length > 0);
    setImages(
      sources.map((s, i) => ({
        id: s.id,
        number: i + 1,
        url: s.imageUrl,
        prompt: "",
        publishedAt: s.publishedAt,
      }))
    );
    setProductGroups(productGroups);
  }, []);

  // Guest funnel (#26): mint an anonymous session on entry so a signed-out
  // visitor can design without hitting the auth wall. No-op when already
  // signed in; the gate now lives at checkout.
  useEffect(() => {
    ensureGuestSession();
  }, []);

  // Landing seed: /design?prompt=… fires one generation with the seeded idea
  // (new designs only — never when resuming via ?id=). Ref-guarded so React
  // Strict Mode's double effect can't fire it twice; the param is stripped
  // immediately so refresh/back doesn't resubmit — via history.replaceState
  // (shallow, no router re-render) because a router.replace issued right
  // before a server-action call gets cancelled by the action. A thin seed is
  // caught by the fast readiness check inside generateDesign and answered
  // with a clarifying question instead of a render — no new guard needed.
  const seedFired = useRef(false);
  useEffect(() => {
    const prompt = searchParams.get("prompt");
    if (!prompt || searchParams.get("id") || seedFired.current) return;
    seedFired.current = true;
    window.history.replaceState(null, "", "/design");
    handleGenerate(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing design if resuming
  const id = searchParams.get("id");
  useEffect(() => {
    if (!id) return;
    Promise.all([getDesign(id), getDesignChat(id)]).then(([design, chat]) => {
      if (!design) return;
      setMessages(chat);
      setSelectedImage(design.displayImageUrl);
    });
    refreshGallery();
  }, [id, refreshGallery]);

  function makeOptimisticMessage(
    role: "user" | "assistant",
    content: string,
    imageId: string | null = null
  ): ChatMessage {
    return {
      id: `optimistic-${crypto.randomUUID()}`,
      designId: designId.current,
      role,
      content,
      imageId,
      createdAt: new Date(),
    };
  }

  async function handleSend(userMessage: string) {
    const token = turns.current.start();
    setLoading(true);
    setOptions([]);
    setMessages((prev) => [...prev, makeOptimisticMessage("user", userMessage)]);

    try {
      await ensureGuestSession();
      const result = await sendChatMessage(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", result.message),
      ]);
      if (turns.current.isCurrent(token)) {
        setReadyToGenerate(result.readyToGenerate);
        setOptions(result.options);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Something went wrong. Try again."),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(userMessage?: string) {
    // One generation at a time: a second Generate while one is in flight is
    // refused (the button shows the in-flight state). #40 made server-side
    // numbering/quota concurrency-safe, but serializing here keeps quota burn
    // and the strip predictable.
    if (activeGeneration.current !== null) return;
    const token = turns.current.start();
    activeGeneration.current = token;
    setGenerating(true);
    setOptions([]);
    if (userMessage) {
      setMessages((prev) => [...prev, makeOptimisticMessage("user", userMessage)]);
    }

    try {
      await ensureGuestSession();
      const result = await generateDesign(designId.current, userMessage);
      // The result always lands in chat + gallery — even after a client-side
      // cancel the server render completed (and the quota unit was spent), so
      // show the image honestly rather than hiding paid work.
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", result.message, result.imageId),
      ]);
      // Claude may answer with a clarifying question instead of an image
      // (no imageUrl) — just show the message, no gallery/drawer changes.
      // The new render lands inline in chat and leads the mobile thumbnail
      // strip — no drawer auto-open needed.
      if (result.imageUrl) {
        await refreshGallery();
      }
      // Composer-adjacent state belongs to the latest turn only: a cancelled
      // or superseded generation must not reset options, readiness, or the
      // user's current selection.
      if (turns.current.isCurrent(token)) {
        setReadyToGenerate(result.readyToGenerate);
        // A clarifying question (no image) may carry tappable style options.
        setOptions("options" in result ? (result.options ?? []) : []);
        if (result.imageUrl) setSelectedImage(result.imageUrl);
      }
    } catch {
      // After a cancel, a failure message is noise — the user moved on.
      if (!turns.current.isCancelled(token)) {
        setMessages((prev) => [
          ...prev,
          makeOptimisticMessage("assistant", "Generation failed. Try again."),
        ]);
      }
    } finally {
      if (activeGeneration.current === token) {
        activeGeneration.current = null;
        setGenerating(false);
      }
    }
  }

  // #59 client-side cancel: stop waiting on the action and free the composer.
  // The server action still runs to completion — its image appears in the
  // strip when it lands (append-only), and the quota unit stays spent because
  // the render actually ran. True server-side Replicate cancel would need a
  // predictions.create/cancel refactor — possible follow-up.
  function handleCancelGenerate() {
    const token = activeGeneration.current;
    if (token === null) return;
    turns.current.cancel(token);
    activeGeneration.current = null;
    setGenerating(false);
  }

  async function handleDeleteImage(imageId: string) {
    const deleted = images.find((img) => img.id === imageId);
    try {
      await deleteDesignImage(designId.current, imageId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      window.alert(msg);
      return;
    }
    await refreshGallery();
    // If lightbox was open on this image, clamp or close
    setImages((current) => {
      if (current.length === 0) {
        setLightboxIndex(null);
      } else if (lightboxIndex !== null) {
        setLightboxIndex(Math.min(lightboxIndex, current.length - 1));
      }
      return current;
    });
    if (deleted && selectedImage === deleted.url) {
      setSelectedImage(null);
    }
  }

  // Publishing opens the modal (name/description/backdrop). Close the
  // lightbox first so the modal isn't stacked on top of it; the modal does
  // the publish and routes to the new public page.
  function handlePublishImage(imageId: string) {
    setLightboxIndex(null);
    setPublishImageId(imageId);
  }

  async function handleUploadImage(base64: string, fileName: string) {
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      makeOptimisticMessage("user", `Uploaded reference image: ${fileName}`),
    ]);

    try {
      await ensureGuestSession();
      const result = await uploadReferenceImage(
        designId.current,
        base64,
        fileName
      );
      // Update the last user message with the image id and refresh
      // gallery so the new design_image row is visible.
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "user") {
          updated[lastIdx] = { ...updated[lastIdx], imageId: result.imageId };
        }
        return updated;
      });
      await refreshGallery();
    } catch {
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Upload failed. Try again."),
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleMakeProducts() {
    if (!selectedImage) return;
    router.push(`/preview?id=${designId.current}`);
  }

  async function handleMakeProductsForImage(imageUrl: string) {
    // selectImage promotes this image to primary_image_id first, so
    // /preview anchors on the user's pick rather than the latest.
    await selectImage(designId.current, imageUrl);
    setSelectedImage(imageUrl);
    router.push(`/preview?id=${designId.current}`);
  }

  async function handleSelectProductVersion(productId: string) {
    router.push(`/preview?id=${designId.current}&product=${productId}`);
  }

  const empty = isDesignEmpty(messages.length, images.length);

  return (
    <div className="h-[calc(100vh-41px)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <Breadcrumbs
            trail={breadcrumbTrail("/design", { id: designId.current })}
            current="Design"
          />
          <h1 className="text-lg font-semibold mt-1">Design</h1>
        </div>
      </div>

      {/* Body — centered composer when empty, two-column working layout otherwise */}
      <div className="flex-1 flex overflow-hidden">
        <ChatPanel
          messages={messages}
          images={images}
          loading={loading}
          generating={generating}
          onSend={handleSend}
          onGenerate={handleGenerate}
          onCancelGenerate={handleCancelGenerate}
          readyToGenerate={readyToGenerate}
          options={options}
          onUploadImage={handleUploadImage}
          isEmpty={empty}
          mobileGalleryStrip={
            <MobileGalleryStrip
              images={images}
              productGroups={productGroups}
              selectedImage={selectedImage}
              generating={generating}
              onClickImage={(i) => setLightboxIndex(i)}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
          }
        />
        {!empty && (
          <ImageGallery
            images={images}
            productGroups={productGroups}
            selectedImage={selectedImage}
            generating={generating}
            onClickImage={(i) => setLightboxIndex(i)}
            onMakeProducts={handleMakeProducts}
            onSelectProductVersion={handleSelectProductVersion}
          />
        )}
      </div>

      {/* Mobile gallery drawer */}
      <MobileGalleryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        images={images}
        productGroups={productGroups}
        selectedImage={selectedImage}
        generating={generating}
        onClickImage={(i) => {
          setDrawerOpen(false);
          setLightboxIndex(i);
        }}
        onMakeProducts={handleMakeProducts}
        onSelectProductVersion={(productId) => {
          setDrawerOpen(false);
          handleSelectProductVersion(productId);
        }}
      />

      {/* Lightbox */}
      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onDelete={handleDeleteImage}
          onMakeProducts={handleMakeProductsForImage}
          onPublish={handlePublishImage}
        />
      )}

      <PublishModal
        imageId={publishImageId}
        open={publishImageId !== null}
        onClose={() => setPublishImageId(null)}
      />
    </div>
  );
}
