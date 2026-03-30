"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { Suspense } from "react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const error_param = searchParams.get("error");

  const [error, setError] = useState(error_param === "INVALID_TOKEN" ? "This reset link is invalid or expired." : "");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token && !error_param) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold">Invalid link</h1>
          <p className="text-gray-600 text-sm">This reset link is missing a token.</p>
          <Link href="/forgot-password" className="text-sm underline">
            Request a new one
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold">Password updated</h1>
          <p className="text-gray-600 text-sm">You can now sign in with your new password.</p>
          <Link href="/sign-in">
            <Button className="w-full">Sign in</Button>
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const newPassword = form.get("password") as string;
    const confirm = form.get("confirm") as string;

    if (newPassword !== confirm) {
      setError("Passwords don't match");
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }

    const { error } = await authClient.resetPassword({
      newPassword,
      token: token!,
    });

    if (error) {
      setError(error.message ?? "Something went wrong");
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-bold text-center">Set new password</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            name="password"
            type="password"
            placeholder="New password"
            required
            minLength={8}
            className="w-full"
          />
          <Input
            name="confirm"
            type="password"
            placeholder="Confirm password"
            required
            minLength={8}
            className="w-full"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <Button type="submit" disabled={loading || !token} className="w-full">
            {loading ? "Updating..." : "Update password"}
          </Button>
        </form>
        <p className="text-center text-sm text-gray-600">
          <Link href="/sign-in" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
