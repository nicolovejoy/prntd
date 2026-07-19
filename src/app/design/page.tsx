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
  approveDesign,
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
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";
import { isDesignEmpty } from "@/lib/design-view";
import { ensureGuestSession } from "@/lib/ensure-guest-session";

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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [images, setImages] = useState<DesignImage[]>([]);
  const [productGroups, setProductGroups] = useState<ProductVersionGroup[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
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
      setReadyToGenerate(result.readyToGenerate);
      setOptions(result.options);
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
    setGenerating(true);
    setOptions([]);
    if (userMessage) {
      setMessages((prev) => [...prev, makeOptimisticMessage("user", userMessage)]);
    }

    try {
      await ensureGuestSession();
      const result = await generateDesign(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", result.message, result.imageId),
      ]);
      setReadyToGenerate(result.readyToGenerate);
      // A clarifying question (no image) may carry tappable style options.
      setOptions("options" in result ? (result.options ?? []) : []);
      // Claude may answer with a clarifying question instead of an image
      // (no imageUrl) — just show the message, no gallery/drawer changes.
      if (result.imageUrl) {
        setSelectedImage(result.imageUrl);
        await refreshGallery();
        // Auto-open gallery drawer on mobile
        if (window.matchMedia("(max-width: 767px)").matches) {
          setDrawerOpen(true);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Generation failed. Try again."),
      ]);
    } finally {
      setGenerating(false);
    }
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
    approveDesign(designId.current).then(() => {
      router.push(`/preview?id=${designId.current}`);
    });
  }

  async function handleMakeProductsForImage(imageUrl: string) {
    // selectImage promotes this image to primary_image_id before approve,
    // so /preview anchors on the user's pick rather than the latest.
    await selectImage(designId.current, imageUrl);
    setSelectedImage(imageUrl);
    await approveDesign(designId.current);
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
          <h1 className="text-lg font-semibold mt-1">
            {empty ? "Start designing" : "Design something"}
          </h1>
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
          readyToGenerate={readyToGenerate}
          options={options}
          onUploadImage={handleUploadImage}
          isEmpty={empty}
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

      {/* Mobile gallery toggle */}
      {(images.length > 0 || productGroups.length > 0) && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-20 right-4 z-30 md:hidden w-12 h-12 rounded-full bg-accent text-accent-fg shadow-lg flex items-center justify-center"
        >
          <span className="text-sm font-bold">{images.length}</span>
        </button>
      )}

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
