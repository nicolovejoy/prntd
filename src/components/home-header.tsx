"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function HomeHeader() {
  const { data: session } = authClient.useSession();

  return (
    <header className="px-6 py-4 flex items-center justify-between">
      <span className="text-xl font-bold tracking-tight">PRNTD</span>
      {session ? (
        <Link
          href="/designs"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          My Designs
        </Link>
      ) : (
        <Link
          href="/sign-in"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
