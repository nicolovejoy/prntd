import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuestPublishPrompt } from "../guest-publish-prompt";

describe("GuestPublishPrompt", () => {
  it("reads as one sentence", () => {
    render(<GuestPublishPrompt next="/d/img-1" />);
    expect(screen.getByTestId("guest-publish-prompt")).toHaveTextContent(
      "Sign up to publish. Have an account? Sign in."
    );
  });

  it("both links carry next", () => {
    render(<GuestPublishPrompt next="/d/img-1" />);
    expect(screen.getByTestId("guest-publish-sign-up")).toHaveAttribute(
      "href",
      "/sign-up?next=%2Fd%2Fimg-1"
    );
    expect(screen.getByTestId("guest-publish-sign-in")).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fd%2Fimg-1"
    );
  });

  it("links are 44px tap targets on phones", () => {
    render(<GuestPublishPrompt next="/d/img-1" />);
    for (const id of ["guest-publish-sign-up", "guest-publish-sign-in"]) {
      const cls = screen.getByTestId(id).className;
      expect(cls).toContain("min-h-11");
      expect(cls).toContain("sm:min-h-0");
    }
  });
});
