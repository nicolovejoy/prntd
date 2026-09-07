/**
 * Nav model A (#219) made /studio the post-sign-in home. Nothing pinned it,
 * so a future sweep could quietly retarget it. This also pins the
 * same-origin restriction on ?next= (open-redirect guard).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignInPage from "../sign-in/page";

const push = vi.fn();
const signInEmail = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
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
  push.mockReset();
  signInEmail.mockReset();
  signInEmail.mockResolvedValue({ error: null });
  search = new URLSearchParams();
});

describe("sign-in redirect target", () => {
  it("defaults to /studio", async () => {
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio"));
  });

  it("honors a same-origin ?next=", async () => {
    search = new URLSearchParams("next=/cart");
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cart"));
  });

  it("refuses a protocol-relative ?next= and falls back to /studio", async () => {
    search = new URLSearchParams("next=//evil.example.com");
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio"));
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
