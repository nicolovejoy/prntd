import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">PRNTD</span>
        <Link
          href="/sign-in"
          className="text-sm text-gray-600 hover:text-black transition-colors"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="max-w-2xl text-center space-y-6">
          <h1 className="text-5xl font-bold tracking-tight">
            Design your perfect t-shirt with AI
          </h1>
          <p className="text-xl text-gray-600 max-w-lg mx-auto">
            Describe your idea in plain English. Our AI generates unique,
            print-ready designs. Order high-quality shirts delivered to your
            door.
          </p>
          <Link
            href="/design"
            className="inline-block px-8 py-3 bg-black text-white text-lg rounded-md font-medium hover:bg-gray-800 transition-colors"
          >
            Start Designing
          </Link>
        </div>
      </main>

      <section className="py-16 px-4 border-t">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="space-y-3">
              <div className="text-3xl font-bold text-gray-300">1</div>
              <h3 className="font-semibold text-lg">Describe your design</h3>
              <p className="text-gray-600">
                Chat with our AI to describe what you want. A vintage sunset, a
                minimalist logo, abstract art — anything you can imagine.
              </p>
            </div>
            <div className="space-y-3">
              <div className="text-3xl font-bold text-gray-300">2</div>
              <h3 className="font-semibold text-lg">Refine until perfect</h3>
              <p className="text-gray-600">
                Preview your design on a shirt mockup. Ask for changes — adjust
                colors, add details, try different styles — until you love it.
              </p>
            </div>
            <div className="space-y-3">
              <div className="text-3xl font-bold text-gray-300">3</div>
              <h3 className="font-semibold text-lg">Order and wear</h3>
              <p className="text-gray-600">
                Choose your size and color, checkout securely, and get a
                high-quality printed shirt delivered to your door.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h2 className="text-2xl font-bold">Pricing</h2>
          <p className="text-gray-600">
            Designing is free to try. You only pay when you order a shirt.
            Prices start at <span className="font-semibold">$29</span> including
            printing and shipping, depending on size and print quality.
          </p>
        </div>
      </section>

      <footer className="py-8 px-4 border-t text-center text-sm text-gray-500 space-y-2">
        <p>PRNTD — AI-powered custom t-shirt design and printing</p>
        <p>
          Questions?{" "}
          <a
            href="mailto:hello@prntd.org"
            className="underline hover:text-gray-700"
          >
            hello@prntd.org
          </a>
        </p>
      </footer>
    </div>
  );
}
