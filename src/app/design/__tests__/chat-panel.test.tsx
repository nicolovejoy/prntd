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
  onCancelGenerate: () => {},
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

  it("hides chips while a chat turn is in flight", () => {
    render(
      <ChatPanel {...baseProps} loading messages={thread} options={options} />
    );
    expect(screen.queryByTestId("chat-options")).toBeNull();
  });

  it("keeps chips tappable while a generation runs (#59)", () => {
    const onSend = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generating
        onSend={onSend}
        messages={thread}
        options={options}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Pun caption" }));
    expect(onSend).toHaveBeenCalledWith("A pun caption over the frog");
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

  it("offers Cancel while generating and reports the tap (#59)", () => {
    const onCancelGenerate = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generating
        onCancelGenerate={onCancelGenerate}
        messages={[thread[0]]}
      />
    );
    fireEvent.click(screen.getByTestId("cancel-generation"));
    expect(onCancelGenerate).toHaveBeenCalledOnce();
  });

  it("shows no Cancel when nothing is generating", () => {
    render(<ChatPanel {...baseProps} messages={thread} />);
    expect(screen.queryByTestId("cancel-generation")).toBeNull();
  });
});

describe("ChatPanel composer during generation (#59)", () => {
  it("leaves the input and Send usable while generating", () => {
    const onSend = vi.fn();
    render(
      <ChatPanel {...baseProps} generating onSend={onSend} messages={thread} />
    );
    const input = screen.getByPlaceholderText(
      "Describe a design or drop an image"
    );
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: "make the frog green" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("make the frog green");
  });

  it("disables Generate and shows the in-flight label while generating", () => {
    render(<ChatPanel {...baseProps} generating messages={thread} />);
    // Button label + the chat status row both read "Generating…".
    const generateBtn = screen
      .getAllByRole("button", { name: "Generating…" })
      .find((el) => el.tagName === "BUTTON");
    expect(generateBtn).toBeDisabled();
  });

  it("routes generate-trigger text to chat while a generation runs", () => {
    // One generation at a time: "make it blue" typed mid-generation becomes a
    // chat turn instead of a refused second generation.
    const onSend = vi.fn();
    const onGenerate = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generating
        onSend={onSend}
        onGenerate={onGenerate}
        messages={thread}
      />
    );
    const input = screen.getByPlaceholderText(
      "Describe a design or drop an image"
    );
    fireEvent.change(input, { target: { value: "make it blue" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("make it blue");
  });

  it("locks the composer during a chat turn (unchanged)", () => {
    render(<ChatPanel {...baseProps} loading messages={thread} />);
    expect(
      screen.getByPlaceholderText("Describe a design or drop an image")
    ).toBeDisabled();
  });
});
