/**
 * Nav model A (#219) made /studio the post-sign-in home. This pins that
 * default on the sign-in page only (sign-up hard-codes the same target,
 * unpinned) plus the same-origin restriction on ?next= (open-redirect guard).
 *
 * Post-sign-in redirect is a hard navigation (window.location.href), not
 * router.push — see the comment in sign-in/page.tsx: router.push() can get
 * stuck behind the header's concurrent session-keyed server action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignInPage from "../sign-in/page";

const signInEmail = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args) },
  },
}));

async function submit() {
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

beforeEach(() => {
  signInEmail.mockReset();
  signInEmail.mockResolvedValue({ error: null });
  search = new URLSearchParams();
  // Hard-navigation redirect target lands on window.location.href, which
  // jsdom won't actually navigate to — make it assignable and observable.
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: "" };
});

describe("sign-in redirect target", () => {
  it("defaults to /studio", async () => {
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("honors a same-origin ?next=", async () => {
    search = new URLSearchParams("next=/cart");
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/cart"));
  });

  it("refuses a protocol-relative ?next= and falls back to /studio", async () => {
    search = new URLSearchParams("next=//evil.example.com");
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("shows the failure line on the negative token, never a raw red", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<SignInPage />);
    await submit();
    const line = await screen.findByText("Invalid credentials");
    expect(line.className).toContain("text-negative");
    expect(line.className).not.toContain("red-600");
  });
});
