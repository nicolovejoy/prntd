"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import Link from "next/link";
import { Button, Input } from "@/components/ui";

export default function SignUpPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signUp.email({
      name: form.get("name") as string,
      email: form.get("email") as string,
      password: form.get("password") as string,
    });

    if (error) {
      setError(error.message ?? "Something went wrong");
      setLoading(false);
      return;
    }

    // Hard navigation, not router.push — see the matching comment in
    // sign-in/page.tsx: the header's session-keyed getHeaderState() effect
    // races the App Router's transition on the same session-identity change,
    // and router.push() can get stuck behind it indefinitely.
    window.location.href = "/studio";
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-bold text-center">Create account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            name="name"
            type="text"
            placeholder="Name"
            required
            className="w-full"
          />
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
            minLength={8}
            className="w-full"
          />
          {error && <p className="text-negative text-sm">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full min-h-11">
            {loading ? "Creating account..." : "Sign up"}
          </Button>
        </form>
        <p className="text-center text-sm text-text-muted">
          Already have an account?{" "}
          <Link href="/sign-in" className="underline underline-offset-[3px]">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
