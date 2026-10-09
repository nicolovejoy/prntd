import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUsageUser, type UsageImage } from "../actions";
import { UsageCard } from "../usage-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HOME } from "@/lib/nav";
import {
  USAGE_IMAGES_LIMIT,
  parseLimit,
  shortId,
  truncatePrompt,
} from "@/lib/admin-usage";
import { formatDisplayDateTime } from "@/lib/display-time-zone";
import { publishedBackdrop } from "@/lib/blanks";
import { wellClass } from "@/lib/artwork-well";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const MAX_LIMIT = USAGE_IMAGES_LIMIT.max;
const LIMIT_STEP = 200;

const LABEL =
  "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";

function ImageCell({ img }: { img: UsageImage }) {
  const { text, truncated } = truncatePrompt(img.prompt);
  // Published (and hidden) images sit on their pinned storefront backdrop,
  // as in the Shop and My Designs; private work sits on the well, ink when
  // the artwork is light (#139, wellForLuminance).
  const backdrop =
    img.status === "private"
      ? { className: wellClass(img.luminance), style: undefined }
      : publishedBackdrop(img.backdropColor);
  return (
    <div
      data-testid="usage-image"
      data-image-id={img.id}
      className="flex gap-3 border border-border bg-surface p-3"
    >
      <Link
        href={`/d/${img.id}`}
        className={`relative block w-24 h-24 shrink-0 border border-border ${backdrop.className}`}
        style={backdrop.style}
      >
        <Image
          src={img.imageUrl}
          alt={`Image ${shortId(img.id)}`}
          fill
          sizes="96px"
          loading="lazy"
          decoding="async"
          className="object-contain"
        />
      </Link>
      <div className="min-w-0 space-y-1">
        <p className={LABEL}>{formatDisplayDateTime(img.createdAt)}</p>
        <p className={LABEL}>
          {img.operation ?? "—"}
          {img.conversationId ? ` · conversation ${shortId(img.conversationId)}` : ""}
          {img.seedIn.length > 0
            ? ` · seed in ${img.seedIn.map(shortId).join(", ")}`
            : ""}
        </p>
        {img.status !== "private" && (
          <p
            className={`font-mono text-[11px] leading-4 tracking-[0.08em] uppercase ${
              img.status === "hidden" ? "text-negative" : "text-text-muted"
            }`}
          >
            {img.status === "hidden" ? "Hidden" : "Published"}
          </p>
        )}
        {img.status !== "published" && (
          <p className="text-xs">
            <a
              href={img.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-[3px] hover:no-underline"
            >
              open image
            </a>
          </p>
        )}
        {truncated ? (
          <details className="text-xs">
            <summary className="cursor-pointer break-words">{text}…</summary>
            <p className="mt-1 break-words">{img.prompt}</p>
          </details>
        ) : text ? (
          <p className="text-xs break-words">{text}</p>
        ) : null}
      </div>
    </div>
  );
}

export default async function AdminUsageUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ limit?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    redirect("/");
  }

  const { userId } = await params;
  const limit = parseLimit((await searchParams).limit, USAGE_IMAGES_LIMIT);
  const detail = await getUsageUser(userId, limit);
  if (!detail) notFound();
  const now = new Date();

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <Breadcrumbs
        trail={[
          HOME,
          { label: "Admin", href: "/admin" },
          { label: "Usage", href: "/admin/usage" },
        ]}
        current={detail.row.label}
        className="mb-4"
      />
      <h1 className="text-xl font-bold mb-6 break-all">{detail.row.label}</h1>

      <UsageCard row={detail.row} now={now} />

      <h2 className="text-lg font-semibold mt-8 mb-4">Images</h2>
      {detail.images.length === 0 ? (
        <p className="text-sm text-text-muted">No images.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {detail.images.map((img) => (
            <ImageCell key={img.id} img={img} />
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-text-muted">
        Showing {detail.images.length} of {detail.imageCount} images, newest
        first.{" "}
        {detail.imageCount > detail.images.length && limit < MAX_LIMIT && (
          <Link
            href={`/admin/usage/${encodeURIComponent(userId)}?limit=${Math.min(limit + LIMIT_STEP, MAX_LIMIT)}`}
            className="underline underline-offset-[3px] hover:no-underline text-foreground"
          >
            Show more
          </Link>
        )}
      </p>
    </div>
  );
}
