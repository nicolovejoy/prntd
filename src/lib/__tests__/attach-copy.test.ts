import { describe, it, expect } from "vitest";
import {
  ATTACH_LABEL,
  ATTACH_BUSY,
  ATTACH_TOO_LARGE,
  ATTACH_UNSUPPORTED,
  ATTACH_FAILED,
  ATTACH_LIMIT_REACHED,
  ATTACH_LIMIT_REACHED_IP,
  ATTACH_CONVERSATION_CLOSED,
  attachLimitMessage,
} from "@/lib/action-copy";

const STRINGS: Array<[string, string, string]> = [
  ["ATTACH_LABEL", ATTACH_LABEL, "Attach image"],
  ["ATTACH_BUSY", ATTACH_BUSY, "Uploading…"],
  ["ATTACH_TOO_LARGE", ATTACH_TOO_LARGE, "That image is over 3 MB. Choose a smaller one."],
  ["ATTACH_UNSUPPORTED", ATTACH_UNSUPPORTED, "That file isn't a supported image. Use a PNG, JPEG or WebP."],
  ["ATTACH_FAILED", ATTACH_FAILED, "Couldn't attach that image. Try again."],
  ["ATTACH_LIMIT_REACHED", ATTACH_LIMIT_REACHED, "You've reached today's upload limit. Try again later."],
  ["ATTACH_LIMIT_REACHED_IP", ATTACH_LIMIT_REACHED_IP, "This network has hit today's upload limit. Try again later."],
  ["ATTACH_CONVERSATION_CLOSED", ATTACH_CONVERSATION_CLOSED, "This conversation is closed."],
];

describe("attach copy", () => {
  it.each(STRINGS)("%s is the agreed string", (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each(STRINGS)("%s has no 'we', 'sorry' or '!' (persona C)", (_name, actual) => {
    expect(actual.toLowerCase()).not.toMatch(/\bwe\b/);
    expect(actual.toLowerCase()).not.toContain("sorry");
    expect(actual).not.toContain("!");
  });

  it("names no price", () => {
    for (const [, s] of STRINGS.map(([n, a]) => [n, a])) expect(s).not.toMatch(/\$/);
  });

  it("attachLimitMessage maps ip to the network line and everything else to the account line", () => {
    expect(attachLimitMessage("ip")).toBe(ATTACH_LIMIT_REACHED_IP);
    expect(attachLimitMessage("identity")).toBe(ATTACH_LIMIT_REACHED);
    expect(attachLimitMessage(undefined)).toBe(ATTACH_LIMIT_REACHED);
  });
});
