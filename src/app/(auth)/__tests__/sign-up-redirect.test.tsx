/**
 * Sign-up lands on /studio by default and honours a same-origin ?next=
 * (open-redirect guard shared with sign-in via safeNextPath). The redirect is
 * a hard navigation — see the comment in sign-up/sign-up-form.tsx.
 *
 * The page is a server component (async function returning JSX) that awaits
 * its `searchParams` prop and resolves the redirect target + cross-link
 * through safeNextPath/withNext before rendering the client form — so these
 * tests call it directly with a resolved searchParams promise, the same way
 * Next.js would, rather than mocking useSearchParams.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignUpPage from "../sign-up/page";

const signUpEmail = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
  },
}));

async function renderSignUp(next?: string) {
  const element = await SignUpPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  });
  return render(element);
}

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
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: "" };
});

describe("sign-up redirect target", () => {
  it("defaults to /studio", async () => {
    await renderSignUp();
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("honors a same-origin ?next=", async () => {
    await renderSignUp("/studio/library");
    await submit();
    await waitFor(() =>
      expect(window.location.href).toBe("/studio/library")
    );
  });

  it("refuses a protocol-relative ?next= and falls back to /studio", async () => {
    await renderSignUp("//evil.example.com");
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("refuses a backslash ?next= and falls back to /studio", async () => {
    await renderSignUp("/\\evil.example.com");
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("carries ?next= on the Sign in link, and none when absent", async () => {
    const { unmount } = await renderSignUp("/studio/library");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fstudio%2Flibrary"
    );
    unmount();

    await renderSignUp();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in"
    );
  });
});
