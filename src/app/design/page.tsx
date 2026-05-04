"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  sendChatMessage,
  generateDesign,
  selectImage,
  deleteGeneration,
  getDesign,
  approveDesign,
  uploadReferenceImage,
} from "./actions";
import { extractImagesFromHistory } from "@/lib/chat-utils";
import type { ChatMessage } from "@/lib/db/schema";
import type { DesignImage } from "@/lib/chat-utils";
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
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Load existing design if resuming
  const id = searchParams.get("id");
  useEffect(() => {
    if (id) {
      getDesign(id).then((design) => {
        if (design) {
          const history = (design.chatHistory as ChatMessage[]) ?? [];
          setMessages(history);
          setImages(extractImagesFromHistory(history));
          setSelectedImage(design.currentImageUrl);
        }
      });
    }
  }, [id]);

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
      const newImage: DesignImage = {
        number: result.generationNumber,
        url: result.imageUrl,
        prompt: "",
      };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.message,
          imageUrl: result.imageUrl,
          generationNumber: result.generationNumber,
        },
      ]);
      setImages((prev) => [...prev, newImage]);
      setSelectedImage(result.imageUrl);
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

  async function handleSelectImage(imageUrl: string) {
    setSelectedImage(imageUrl);
    await selectImage(designId.current, imageUrl);
  }

  async function handleDeleteImage(generationNumber: number) {
    await deleteGeneration(designId.current, generationNumber);
    setImages((prev) => prev.filter((img) => img.number !== generationNumber));
    // Close lightbox if no images left, or navigate
    const remaining = images.filter(
      (img) => img.number !== generationNumber
    );
    if (remaining.length === 0) {
      setLightboxIndex(null);
      setSelectedImage(null);
    } else {
      // If deleted image was selected, pick the last remaining
      const deleted = images.find((img) => img.number === generationNumber);
      if (deleted && selectedImage === deleted.url) {
        const last = remaining[remaining.length - 1];
        setSelectedImage(last.url);
        await selectImage(designId.current, last.url);
      }
      // Adjust lightbox index
      if (lightboxIndex !== null) {
        const newIndex = Math.min(lightboxIndex, remaining.length - 1);
        setLightboxIndex(newIndex);
      }
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

  function handleUseDesign() {
    if (!selectedImage) return;
    approveDesign(designId.current).then(() => {
      router.push(`/preview?id=${designId.current}`);
    });
  }

  async function handleUseSpecificImage(imageUrl: string) {
    await selectImage(designId.current, imageUrl);
    setSelectedImage(imageUrl);
    await approveDesign(designId.current);
    router.push(`/preview?id=${designId.current}`);
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
          selectedImage={selectedImage}
          generating={generating}
          onClickImage={(i) => setLightboxIndex(i)}
          onUseDesign={handleUseDesign}
        />
      </div>

      {/* Mobile gallery toggle */}
      {images.length > 0 && (
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
        selectedImage={selectedImage}
        generating={generating}
        onClickImage={(i) => {
          setDrawerOpen(false);
          setLightboxIndex(i);
        }}
        onUseDesign={handleUseDesign}
      />

      {/* Lightbox */}
      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onDelete={handleDeleteImage}
          onUseDesign={handleUseSpecificImage}
        />
      )}
    </div>
  );
}
