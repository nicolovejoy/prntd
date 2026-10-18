import { describe, it, expect } from "vitest";
import { latestUserText } from "../design-prompt";

describe("latestUserText", () => {
  const thread = [
    { role: "user", content: "a dog on a skateboard" },
    { role: "assistant", content: "What style?" },
  ];

  it("returns the most recent user turn", () => {
    expect(latestUserText(thread)).toBe("a dog on a skateboard");
  });

  it("ignores assistant turns, however recent", () => {
    expect(
      latestUserText([...thread, { role: "assistant", content: "Still here?" }])
    ).toBe("a dog on a skateboard");
  });

  it("skips back over an empty user turn", () => {
    expect(latestUserText([...thread, { role: "user", content: "   " }])).toBe(
      "a dog on a skateboard"
    );
  });

  it("is null when the user has never said anything", () => {
    expect(latestUserText([])).toBeNull();
    expect(latestUserText([{ role: "assistant", content: "hi" }])).toBeNull();
  });
});
