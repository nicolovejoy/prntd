import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../unpublish-action", () => ({
  UnpublishAction: () => <button>Un-publish</button>,
}));
vi.mock("../publish-cta", () => ({
  PublishCta: () => <button>Publish</button>,
}));
vi.mock("../conversation-actions", () => ({
  ConversationActions: ({ designId, imageId }: { designId: string; imageId: string }) => (
    <button data-design-id={designId} data-image-id={imageId}>
      Open conversation
    </button>
  ),
}));

import { OwnerActions } from "../owner-actions";

describe("OwnerActions", () => {
  it("labels the group and offers Un-publish for a published image", () => {
    render(
      <OwnerActions
        imageId="img-1"
        imageUrl="https://img.example/1.png"
        isPublished
        canPublish
        sourceDesignId="design-1"
        conversationArchived={false}
      />
    );
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Un-publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    const open = screen.getByRole("button", { name: "Open conversation" });
    expect(open).toBeInTheDocument();
    // The stage opens on the image the page shows, so the row passes it down.
    expect(open).toHaveAttribute("data-design-id", "design-1");
    expect(open).toHaveAttribute("data-image-id", "img-1");
  });

  it("states unpublished status and offers Publish", () => {
    render(
      <OwnerActions
        imageId="img-1"
        imageUrl="https://img.example/1.png"
        isPublished={false}
        canPublish
        sourceDesignId="design-1"
        conversationArchived={false}
      />
    );
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("omits the conversation actions when the conversation is gone", () => {
    render(
      <OwnerActions
        imageId="img-1"
        imageUrl="https://img.example/1.png"
        isPublished
        canPublish
        sourceDesignId={null}
        conversationArchived={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Open conversation" })
    ).not.toBeInTheDocument();
  });
});
