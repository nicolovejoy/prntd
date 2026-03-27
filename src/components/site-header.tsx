import Link from "next/link";

export function SiteHeader() {
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE ?? "dev";

  return (
    <header className="px-6 py-2 flex items-center justify-between border-b text-sm">
      <Link href="/" className="font-bold tracking-tight">
        PRNTD
      </Link>
      <span className="text-xs text-gray-400 font-mono">{buildDate}</span>
    </header>
  );
}
