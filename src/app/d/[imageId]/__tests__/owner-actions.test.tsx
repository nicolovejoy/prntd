import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// identity-block.tsx (real module) re-exports MONO_LABEL alongside
// IdentityBlock, which imports editable-naming.tsx -> "@/app/designs/actions"
// (a real "use server" module) -> "@/lib/auth" -> better-auth's tracer,
// which needs an unresolvable "@opentelemetry/api" under vitest (the same
// trap publish-cta.test.tsx and identity-block.test.tsx route around).
// OwnerActions only consumes the string constant, so stub the module to
// just that.
vi.mock("../identity-block", () => ({ MONO_LABEL: "mono-label" }));
vi.mock("../unpublish-action", () => ({
  UnpublishAction: () => <button>Un-publish</button>,
}));
vi.mock("../publish-cta", () => ({
  PublishCta: () => <button>Publish</button>,
}));
vi.mock("../conversation-actions", () => ({
  ConversationActions: () => <button>Open conversation</button>,
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
    expect(
      screen.getByRole("button", { name: "Open conversation" })
    ).toBeInTheDocument();
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
