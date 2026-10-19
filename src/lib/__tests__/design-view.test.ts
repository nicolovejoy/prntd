import { describe, it, expect } from "vitest";
import {
  assertConversationOpen,
  CONVERSATION_CLOSED_MESSAGE,
  deleteConversationConsequence,
} from "@/lib/design-view";

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

describe("deleteConversationConsequence", () => {
  it("names the Shop first when the conversation has a listing", () => {
    expect(deleteConversationConsequence(true)).toBe(
      "Its published images leave the Shop. Images used in an order, another design, or a cart are kept. A conversation with an order is archived instead."
    );
  });

  it("is unchanged without a listing", () => {
    expect(deleteConversationConsequence(false)).toBe(
      "Images used in an order, another design, or a cart are kept. A conversation with an order is archived instead."
    );
  });
});
