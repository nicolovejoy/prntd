import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <main className="max-w-lg text-center space-y-8">
        <h1 className="text-5xl font-bold tracking-tight">PRNTD</h1>
        <p className="text-xl text-gray-600">
          Design your perfect t-shirt with AI. Describe it, refine it, wear it.
        </p>
        <Link
          href="/design"
          className="inline-block px-8 py-3 bg-black text-white text-lg rounded-md font-medium hover:bg-gray-800 transition-colors"
        >
          Start Designing
        </Link>
      </main>
    </div>
  );
}
