"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  sendChatMessage,
  generateDesign,
  selectImage,
  deleteDesignImage,
  getDesign,
  getDesignGallery,
  approveDesign,
  uploadReferenceImage,
} from "./actions";
import type { ChatMessage } from "@/lib/db/schema";
import type { DesignImage } from "@/lib/chat-utils";
import type { ProductVersionGroup } from "@/lib/design-images";
import { ChatPanel } from "./chat-panel";
import { ImageGallery } from "./image-gallery";
import { ImageLightbox } from "./image-lightbox";
import { MobileGalleryDrawer } from "./mobile-gallery-drawer";

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refreshGallery = useCallback(async () => {
    const { sources, productGroups } = await getDesignGallery(designId.current);
    setImages(
      sources.map((s, i) => ({
        id: s.id,
        number: i + 1,
        url: s.imageUrl,
        prompt: "",
      }))
    );
    setProductGroups(productGroups);
  }, []);

  // Load existing design if resuming
  const id = searchParams.get("id");
  useEffect(() => {
    if (!id) return;
    getDesign(id).then((design) => {
      if (!design) return;
      const history = (design.chatHistory as ChatMessage[]) ?? [];
      setMessages(history);
      setSelectedImage(design.displayImageUrl);
    });
    refreshGallery();
  }, [id, refreshGallery]);

  async function handleSend(userMessage: string) {
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendChatMessage(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.message },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong. Try again?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(userMessage?: string) {
    setGenerating(true);
    if (userMessage) {
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    }

    try {
      const result = await generateDesign(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          imageUrl: result.imageUrl,
          generationNumber: result.generationNumber,
        },
      ]);
      setSelectedImage(result.imageUrl);
      await refreshGallery();
      // Auto-open gallery drawer on mobile
      if (window.matchMedia("(max-width: 767px)").matches) {
        setDrawerOpen(true);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Image generation failed. Try again?",
        },
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

  async function handleUploadImage(base64: string, fileName: string) {
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `Uploaded reference image: ${fileName}` },
    ]);

    try {
      const result = await uploadReferenceImage(
        designId.current,
        base64,
        fileName
      );
      // Update the last user message with the image URL
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "user") {
          updated[lastIdx] = { ...updated[lastIdx], imageUrl: result.imageUrl };
        }
        return updated;
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Image upload failed. Try again?" },
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

  return (
    <div className="h-[calc(100vh-41px)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <Link
            href="/designs"
            className="text-sm text-gray-500 hover:underline"
          >
            &larr; My Designs
          </Link>
          <h1 className="text-lg font-semibold mt-1">Design something</h1>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex-1 flex overflow-hidden">
        <ChatPanel
          messages={messages}
          loading={loading}
          generating={generating}
          onSend={handleSend}
          onGenerate={handleGenerate}
          onUploadImage={handleUploadImage}
        />
        <ImageGallery
          images={images}
          productGroups={productGroups}
          selectedImage={selectedImage}
          generating={generating}
          onClickImage={(i) => setLightboxIndex(i)}
          onMakeProducts={handleMakeProducts}
          onSelectProductVersion={handleSelectProductVersion}
        />
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
        />
      )}
    </div>
  );
}
