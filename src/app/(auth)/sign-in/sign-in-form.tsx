"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import Link from "next/link";
import { Button, Input } from "@/components/ui";

export type SignInFormProps = {
  /** Where a successful sign-in redirects to — already resolved through
   * safeNextPath on the server, so this is always a safe same-origin path. */
  redirectTo: string;
  /** href for the "Sign up" link, already carrying ?next= (via withNext) so
   * a visitor who followed a next= link here keeps it if they sign up instead. */
  signUpHref: string;
};

export function SignInForm({ redirectTo, signUpHref }: SignInFormProps) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: form.get("email") as string,
      password: form.get("password") as string,
    });

    if (error) {
      setError(error.message ?? "Invalid credentials");
      setLoading(false);
      return;
    }

    // Hard navigation, not router.push: the header's session-keyed
    // getHeaderState() effect (site-header.tsx) fires a server action the
    // instant this sign-in flips session?.user?.id, and that can race the
    // App Router's client-side transition badly enough that router.push()
    // never lands — button stuck on "Signing in...", URL never changes, no
    // pending network request, only a reload recovers. window.location.href
    // can't get stuck behind another pending action. Same reasoning as
    // signOut() in site-header.tsx.
    window.location.href = redirectTo;
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-bold text-center">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            name="email"
            type="email"
            placeholder="Email"
            required
            className="w-full"
          />
          <Input
            name="password"
            type="password"
            placeholder="Password"
            required
            className="w-full"
          />
          {error && <p className="text-negative text-sm">{error}</p>}
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-sm text-text-muted underline underline-offset-[3px] hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Button type="submit" disabled={loading} className="w-full min-h-11">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <p className="text-center text-sm text-text-muted">
          Don&apos;t have an account?{" "}
          <Link
            href={signUpHref}
            className="underline underline-offset-[3px]"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
