import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ChatPanel } from "../chat-panel";
import type { ChatMessage } from "@/lib/db/schema";

beforeAll(() => {
  // jsdom has no scrollIntoView; the panel auto-scrolls on every turn.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function msg(role: "user" | "assistant", content: string): ChatMessage {
  return {
    id: `m-${role}-${Math.random().toString(36).slice(2, 8)}`,
    designId: "d1",
    role,
    content,
    imageId: null,
    createdAt: new Date(),
  };
}

const baseProps = {
  images: [],
  loading: false,
  generating: false,
  onSend: () => {},
  onGenerate: () => {},
  readyToGenerate: true,
  options: [],
  onUploadImage: () => {},
  isEmpty: false,
};

const thread = [msg("user", "Something funny involving a frog"), msg("assistant", "What's the vibe?")];

const options = [
  { label: "Funny scenario", value: "A frog in a funny scenario" },
  // Note: a value starting with "go"/"draw"/"make it" would hit the
  // generate-trigger regex and route to onGenerate — intended behavior.
  { label: "Pun caption", value: "A pun caption over the frog" },
];

describe("ChatPanel quick-reply placement", () => {
  it("renders chips inside the message list, under the latest assistant message (#69)", () => {
    render(<ChatPanel {...baseProps} messages={thread} options={options} />);
    // Chips live in the scrolling message flow, not stranded above the composer.
    const messagesBox = screen.getByTestId("chat-messages");
    const chips = within(messagesBox).getByTestId("chat-options");
    expect(
      within(chips).getByRole("button", { name: "Funny scenario" })
    ).toBeInTheDocument();
    // Directly after the last message: nothing between them but the chips row.
    const lastMessage = within(messagesBox).getByTestId("chat-message-assistant");
    expect(lastMessage.nextElementSibling).toBe(chips);
  });

  it("submits the option value as the user's turn on tap", () => {
    const onSend = vi.fn();
    render(
      <ChatPanel {...baseProps} onSend={onSend} messages={thread} options={options} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Pun caption" }));
    expect(onSend).toHaveBeenCalledWith("A pun caption over the frog");
  });

  it("hides chips while a turn is in flight", () => {
    render(
      <ChatPanel {...baseProps} generating messages={thread} options={options} />
    );
    expect(screen.queryByTestId("chat-options")).toBeNull();
  });
});

describe("ChatPanel generating status", () => {
  it("shows a single static line while generating (Clean Label)", () => {
    render(
      <ChatPanel {...baseProps} generating messages={[thread[0]]} />
    );
    expect(screen.getByTestId("drawing-status")).toHaveTextContent(
      "Generating…"
    );
  });
});
