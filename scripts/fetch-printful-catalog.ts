/**
 * Search Printful product catalog for a product by name.
 *
 * Run with: npx tsx scripts/fetch-printful-catalog.ts [search term]
 * Example:  npx tsx scripts/fetch-printful-catalog.ts "clear case iphone"
 *
 * No API key needed — the catalog endpoint is public.
 */

const PRINTFUL_API = "https://api.printful.com";

async function printfulFetch(path: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Use API key if available, but catalog endpoint works without it
  if (process.env.PRINTFUL_API_KEY) {
    headers.Authorization = `Bearer ${process.env.PRINTFUL_API_KEY}`;
  }
  const res = await fetch(`${PRINTFUL_API}${path}`, { headers });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Printful API error: ${res.status} ${error}`);
  }
  return res.json();
}

async function main() {
  const search = process.argv.slice(2).join(" ").toLowerCase() || "clear case iphone";
  console.log(`Searching Printful catalog for: "${search}"\n`);

  const data = await printfulFetch("/products");
  const products = data.result as { id: number; title: string; type: string; type_name: string }[];

  const matches = products.filter(
    (p) => p.title.toLowerCase().includes(search) || p.type_name.toLowerCase().includes(search)
  );

  if (matches.length === 0) {
    console.log("No matches. Showing all phone case products:\n");
    const cases = products.filter(
      (p) => p.type_name.toLowerCase().includes("case") || p.title.toLowerCase().includes("case")
    );
    for (const p of cases) {
      console.log(`  ID: ${p.id} | ${p.title} (${p.type_name})`);
    }
  } else {
    console.log(`Found ${matches.length} matches:\n`);
    for (const p of matches) {
      console.log(`  ID: ${p.id} | ${p.title} (${p.type_name})`);
    }
  }
}

main().catch(console.error);
