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
  runningJobs: [],
  atCapacity: false,
  generationError: null,
  onDismissGenerationError: () => {},
  onSend: () => {},
  onGenerate: () => {},
  onCancelJob: () => {},
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

const job = (jobId: string, generationNumber: number) => ({
  jobId,
  generationNumber,
});

describe("ChatPanel generating status", () => {
  it("shows a single static line while generating (Clean Label)", () => {
    render(
      <ChatPanel
        {...baseProps}
        generating
        runningJobs={[job("j1", 1)]}
        messages={[thread[0]]}
      />
    );
    expect(screen.getByTestId("drawing-status")).toHaveTextContent(
      "Generating…"
    );
  });

  it("renders one cancellable row per running job", () => {
    // Three concurrent generations is the point of the durable job — one
    // shared status row would make two of them invisible.
    render(
      <ChatPanel
        {...baseProps}
        generating
        runningJobs={[job("j1", 1), job("j2", 2), job("j3", 3)]}
        messages={[thread[0]]}
      />
    );
    expect(screen.getAllByTestId("generating-row")).toHaveLength(3);
  });

  it("cancels the job whose row was tapped (#59, now durable)", () => {
    const onCancelJob = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generating
        runningJobs={[job("j1", 1), job("j2", 2)]}
        onCancelJob={onCancelJob}
        messages={[thread[0]]}
      />
    );
    fireEvent.click(screen.getAllByTestId("cancel-generation")[1]);
    expect(onCancelJob).toHaveBeenCalledWith("j2");
  });

  it("shows no Cancel when nothing is generating", () => {
    render(<ChatPanel {...baseProps} messages={thread} />);
    expect(screen.queryByTestId("cancel-generation")).toBeNull();
  });

  it("surfaces a background failure inline and can dismiss it", () => {
    const onDismissGenerationError = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generationError="Generation timed out"
        onDismissGenerationError={onDismissGenerationError}
        messages={thread}
      />
    );
    expect(screen.getByTestId("generation-error")).toHaveTextContent(
      "Generation timed out"
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismissGenerationError).toHaveBeenCalledOnce();
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

  it("keeps Generate live while one generation runs — the cap is the only refusal", () => {
    render(
      <ChatPanel
        {...baseProps}
        generating
        runningJobs={[job("j1", 1)]}
        messages={thread}
      />
    );
    const generateBtn = screen
      .getAllByRole("button", { name: "Generating…" })
      .find((el) => el.tagName === "BUTTON");
    expect(generateBtn).not.toBeDisabled();
  });

  it("disables Generate at the concurrency cap", () => {
    render(
      <ChatPanel
        {...baseProps}
        generating
        atCapacity
        runningJobs={[job("j1", 1), job("j2", 2), job("j3", 3)]}
        messages={thread}
      />
    );
    const generateBtn = screen
      .getAllByRole("button", { name: "Generating…" })
      .find((el) => el.tagName === "BUTTON");
    expect(generateBtn).toBeDisabled();
  });

  it("routes generate-trigger text to a new generation while one runs", () => {
    const onSend = vi.fn();
    const onGenerate = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generating
        runningJobs={[job("j1", 1)]}
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
    expect(onGenerate).toHaveBeenCalledWith("make it blue");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("routes generate-trigger text to chat at the cap", () => {
    const onSend = vi.fn();
    const onGenerate = vi.fn();
    render(
      <ChatPanel
        {...baseProps}
        generating
        atCapacity
        runningJobs={[job("j1", 1), job("j2", 2), job("j3", 3)]}
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

describe("ChatPanel closed conversation (slice 3)", () => {
  it("swaps the composer for the closed notice + Reopen", () => {
    const onReopen = vi.fn();
    render(
      <ChatPanel {...baseProps} closed onReopen={onReopen} messages={thread} />
    );
    // History stays visible…
    expect(screen.getByTestId("chat-messages")).toBeInTheDocument();
    // …but the composer is gone.
    expect(
      screen.queryByPlaceholderText("Describe a design or drop an image")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate" })
    ).not.toBeInTheDocument();

    expect(screen.getByTestId("closed-notice")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reopen-design"));
    expect(onReopen).toHaveBeenCalled();
  });

  it("renders the composer when open (default)", () => {
    render(<ChatPanel {...baseProps} messages={thread} />);
    expect(
      screen.getByPlaceholderText("Describe a design or drop an image")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("closed-notice")).not.toBeInTheDocument();
  });
});
