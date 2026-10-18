import { describe, it, expect } from "vitest";
import { assertConversationOpen, CONVERSATION_CLOSED_MESSAGE } from "@/lib/design-view";

describe("assertConversationOpen", () => {
  it("passes an open conversation through", () => {
    expect(() => assertConversationOpen({ closedAt: null })).not.toThrow();
  });

  it("throws the closed message for a closed conversation", () => {
    expect(() => assertConversationOpen({ closedAt: new Date() })).toThrow(
      CONVERSATION_CLOSED_MESSAGE
    );
  });
});
