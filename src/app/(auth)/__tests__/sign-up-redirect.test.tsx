/**
 * Sign-up lands on /studio by default and honours a same-origin ?next=
 * (open-redirect guard shared with sign-in via safeNextPath). The redirect is
 * a hard navigation — see the comment in sign-up/page.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignUpPage from "../sign-up/page";

const signUpEmail = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
  },
}));

async function submit() {
  fireEvent.change(screen.getByPlaceholderText("Name"), {
    target: { value: "Ada" },
  });
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
}

beforeEach(() => {
  signUpEmail.mockReset();
  signUpEmail.mockResolvedValue({ error: null });
  search = new URLSearchParams();
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: "" };
});

describe("sign-up redirect target", () => {
  it("defaults to /studio", async () => {
    render(<SignUpPage />);
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("honors a same-origin ?next=", async () => {
    search = new URLSearchParams("next=/studio/library");
    render(<SignUpPage />);
    await submit();
    await waitFor(() =>
      expect(window.location.href).toBe("/studio/library")
    );
  });

  it("refuses a protocol-relative ?next= and falls back to /studio", async () => {
    search = new URLSearchParams("next=//evil.example.com");
    render(<SignUpPage />);
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("refuses a backslash ?next= and falls back to /studio", async () => {
    search = new URLSearchParams("next=/\\evil.example.com");
    render(<SignUpPage />);
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("carries ?next= on the Sign in link, and none when absent", () => {
    search = new URLSearchParams("next=/studio/library");
    const { unmount } = render(<SignUpPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fstudio%2Flibrary"
    );
    unmount();
    search = new URLSearchParams();
    render(<SignUpPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in"
    );
  });
});
