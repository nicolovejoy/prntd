/**
 * Nav model A (#219) made /studio the post-sign-in home. This pins that
 * default on the sign-in page (sign-up has its own test) plus the same-origin
 * restriction on ?next= (open-redirect guard) and that the "Sign up" link
 * carries ?next= along.
 *
 * The page is a server component (async function returning JSX) that awaits
 * its `searchParams` prop and resolves the redirect target + cross-link
 * through safeNextPath/withNext before rendering the client form — so these
 * tests call it directly with a resolved searchParams promise, the same way
 * Next.js would, rather than mocking useSearchParams.
 *
 * Post-sign-in redirect is a hard navigation (window.location.href), not
 * router.push — see the comment in sign-in/sign-in-form.tsx: router.push()
 * can get stuck behind the header's concurrent session-keyed server action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignInPage from "../sign-in/page";

const signInEmail = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args) },
  },
}));

async function renderSignIn(next?: string) {
  const element = await SignInPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  });
  render(element);
}

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
  // Hard-navigation redirect target lands on window.location.href, which
  // jsdom won't actually navigate to — make it assignable and observable.
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: "" };
});

describe("sign-in redirect target", () => {
  it("defaults to /studio", async () => {
    await renderSignIn();
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("honors a same-origin ?next=", async () => {
    await renderSignIn("/cart");
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/cart"));
  });

  it("refuses a protocol-relative ?next= and falls back to /studio", async () => {
    await renderSignIn("//evil.example.com");
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("refuses a backslash ?next= (browsers read it as //) and falls back to /studio", async () => {
    await renderSignIn("/\\evil.example.com");
    await submit();
    await waitFor(() => expect(window.location.href).toBe("/studio"));
  });

  it("carries ?next= on the Sign up link", async () => {
    await renderSignIn("/cart");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/sign-up?next=%2Fcart"
    );
  });

  it("shows the failure line on the negative token, never a raw red", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid credentials" } });
    await renderSignIn();
    await submit();
    const line = await screen.findByText("Invalid credentials");
    expect(line.className).toContain("text-negative");
    expect(line.className).not.toContain("red-600");
  });
});
