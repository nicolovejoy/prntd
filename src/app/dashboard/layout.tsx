import { notFound } from "next/navigation";
import { storesEnabled } from "@/lib/flags";

// Organizer storefronts are retired (#191). The dashboard pages are client
// components that would otherwise render an empty "create a shop" form with
// the flag off (every action already refuses), so gate the whole segment here:
// /dashboard, /dashboard/products/new and /dashboard/products/[id]/edit all
// 404 until the flag is on. The public /shop/[slug] routes already 404 via
// getStorefront/getStoreProductForBuy returning null.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!storesEnabled()) notFound();
  return children;
}
