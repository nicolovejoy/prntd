"use client";

import { useEffect } from "react";
import { ImageGallery } from "./image-gallery";
import type { DesignImage } from "@/lib/chat-utils";

export function MobileGalleryDrawer({
  open,
  onClose,
  images,
  selectedImage,
  generating,
  onClickImage,
  onUseDesign,
}: {
  open: boolean;
  onClose: () => void;
  images: DesignImage[];
  selectedImage: string | null;
  generating: boolean;
  onClickImage: (index: number) => void;
  onUseDesign: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-40 w-80 max-w-[85vw] transition-transform duration-200 md:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <ImageGallery
          className="w-full h-full flex flex-col bg-background border-l border-border"
          images={images}
          selectedImage={selectedImage}
          generating={generating}
          onClickImage={onClickImage}
          onUseDesign={onUseDesign}
        />
      </div>
    </>
  );
}
