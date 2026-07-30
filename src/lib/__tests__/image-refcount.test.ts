/**
 * Pure decision matrix for image deletion once images are shared across
 * conversations (Model B slice 4, plan §7). Order references block; any other
 * reference downgrades to a link-detach; nothing referenced → hard delete.
 */
import { describe, it, expect } from "vitest";
import { imageReferences, type ImageReferenceFlags } from "@/lib/design-publish";

const none: ImageReferenceFlags = {
  order: false,
  otherConversation: false,
  product: false,
  cart: false,
};

describe("imageReferences", () => {
  it("deletes when nothing references the image", () => {
    expect(imageReferences(none)).toBe("delete");
  });

  it("blocks on an order reference", () => {
    expect(imageReferences({ ...none, order: true })).toBe("blocked");
  });

  it("order blocks even when other references exist too", () => {
    expect(
      imageReferences({
        order: true,
        otherConversation: true,
        product: true,
        cart: true,
      })
    ).toBe("blocked");
  });

  it("detaches when another conversation links the image", () => {
    expect(imageReferences({ ...none, otherConversation: true })).toBe("detach");
  });

  it("detaches when a shop product pins the image", () => {
    expect(imageReferences({ ...none, product: true })).toBe("detach");
  });

  it("detaches when a cart line pins the image", () => {
    expect(imageReferences({ ...none, cart: true })).toBe("detach");
  });

  it("detaches on any combination of non-order references", () => {
    expect(
      imageReferences({ ...none, otherConversation: true, product: true })
    ).toBe("detach");
    expect(imageReferences({ ...none, product: true, cart: true })).toBe(
      "detach"
    );
  });
});
