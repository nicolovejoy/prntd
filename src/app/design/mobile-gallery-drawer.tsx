"use client";

import { useEffect } from "react";
import { ImageGallery } from "./image-gallery";
import type { DesignImage } from "@/lib/chat-utils";
import type { ProductVersionGroup } from "@/lib/design-images";

export function MobileGalleryDrawer({
  open,
  onClose,
  images,
  productGroups,
  selectedImage,
  generating,
  onClickImage,
  onMakeProducts,
  onSelectProductVersion,
}: {
  open: boolean;
  onClose: () => void;
  images: DesignImage[];
  productGroups: ProductVersionGroup[];
  selectedImage: string | null;
  generating: boolean;
  onClickImage: (index: number) => void;
  onMakeProducts: () => void;
  onSelectProductVersion: (productId: string) => void;
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
          productGroups={productGroups}
          selectedImage={selectedImage}
          generating={generating}
          onClickImage={onClickImage}
          onMakeProducts={onMakeProducts}
          onSelectProductVersion={onSelectProductVersion}
        />
      </div>
    </>
  );
}
