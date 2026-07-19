import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getRecentPublishedForAdmin,
  setImageHidden,
  setImageFeedRank,
} from "../actions";
import { Button, Input } from "@/components/ui";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbTrail } from "@/lib/nav";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export default async function AdminPublishedPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    redirect("/");
  }

  const images = await getRecentPublishedForAdmin(100);

  async function toggle(formData: FormData) {
    "use server";
    const imageId = String(formData.get("imageId"));
    const hidden = formData.get("hidden") === "true";
    await setImageHidden(imageId, hidden);
  }

  async function saveRank(formData: FormData) {
    "use server";
    const imageId = String(formData.get("imageId"));
    const raw = String(formData.get("rank") ?? "").trim();
    await setImageFeedRank(imageId, raw === "" ? null : Number(raw));
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <Breadcrumbs
        trail={breadcrumbTrail("/admin/published")}
        current="Published images"
        className="mb-4"
      />
      <h1 className="text-xl font-bold mb-6">Published images</h1>

      {images.length === 0 ? (
        <p className="text-text-muted">No published images yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {images.map((img) => (
            <div
              key={img.imageId}
              className={`border rounded-md overflow-hidden ${
                img.isHidden ? "border-negative opacity-60" : "border-border"
              }`}
            >
              <Link
                href={`/d/${img.imageId}`}
                className="block aspect-square bg-checkerboard"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.imageUrl}
                  alt={img.title ?? "Design"}
                  className="w-full h-full object-contain"
                />
              </Link>
              <div className="p-3 space-y-2">
                {img.title && (
                  <p className="text-sm font-medium truncate">{img.title}</p>
                )}
                <p className="text-xs text-text-muted truncate">
                  {img.designerName} · {img.designerEmail}
                </p>
                <p className="text-xs text-text-faint">
                  {img.publishedAt.toLocaleDateString()}
                </p>
                {/* Shop feed position. Ranked images list first (lowest
                    number first); blank = unranked, recency order. */}
                <form action={saveRank} className="flex gap-2">
                  <input type="hidden" name="imageId" value={img.imageId} />
                  <Input
                    type="number"
                    name="rank"
                    inputMode="numeric"
                    min={1}
                    max={9999}
                    defaultValue={img.feedRank ?? ""}
                    placeholder="Rank"
                    aria-label="Shop feed rank"
                    className="w-full min-w-0 min-h-11 px-2 text-sm"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    className="min-h-11 shrink-0"
                  >
                    Save
                  </Button>
                </form>
                <form action={toggle}>
                  <input type="hidden" name="imageId" value={img.imageId} />
                  <input
                    type="hidden"
                    name="hidden"
                    value={img.isHidden ? "false" : "true"}
                  />
                  <Button
                    type="submit"
                    variant={img.isHidden ? "secondary" : "danger"}
                    size="sm"
                    className="w-full"
                  >
                    {img.isHidden ? "Unhide" : "Hide"}
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
