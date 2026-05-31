import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublishedImage } from "../actions";
import { auth } from "@/lib/auth";
import { EditableNaming } from "./editable-naming";
import { BuyPanel } from "./buy-panel";

type Params = Promise<{ imageId: string }>;

export default async function PublishedImagePage({
  params,
}: {
  params: Params;
}) {
  const { imageId } = await params;
  const img = await getPublishedImage(imageId);
  if (!img) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  const isLoggedIn = Boolean(session);
  const isOwner = session?.user.id === img.designerId;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="bg-checkerboard rounded-lg overflow-hidden border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.imageUrl}
              alt={img.title ?? "Design"}
              className="w-full h-auto object-contain"
            />
          </div>

          <div className="space-y-2">
            <EditableNaming
              imageId={img.imageId}
              title={img.title}
              description={img.description}
              canEdit={isOwner}
            />
            <p className="text-sm text-text-muted">by {img.designerName}</p>
            {img.forkChain.length > 0 && (
              <p className="text-sm text-text-faint">
                Forked from{" "}
                {img.forkChain.map((link, i) => (
                  <span key={link.imageId}>
                    {i > 0 && " ← "}
                    <Link
                      href={`/d/${link.imageId}`}
                      className="underline hover:text-text-muted"
                    >
                      {link.title ?? "an earlier design"}
                    </Link>{" "}
                    by {link.designerName}
                  </span>
                ))}
              </p>
            )}
          </div>

          <BuyPanel imageId={img.imageId} isLoggedIn={isLoggedIn} />
        </div>
      </main>
    </div>
  );
}
