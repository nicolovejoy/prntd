import { Breadcrumbs } from "@/components/breadcrumbs";
import type { Crumb } from "@/lib/nav";
import { MONO_LABEL } from "./mono-label";

const HELP_EMAIL = "help@prntd.org";

/**
 * What the owner of an admin-hidden image sees at `/d/[imageId]` in place of
 * the artwork (#288). Plain notice, no reason, one way to ask. Deliberately
 * has no image, no lightbox and no buttons: the image can't be ordered,
 * published or started from, and the page shows nothing it could be done to.
 */
export function HiddenNotice({
  trail,
  title,
}: {
  trail: Crumb[];
  title: string | null;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-4 py-6 md:py-8">
        <div className="max-w-3xl mx-auto space-y-4">
          <Breadcrumbs trail={trail} current={title?.trim() || "Design"} />
          <section className="border border-foreground p-4 space-y-3">
            <h1 className={MONO_LABEL}>Hidden</h1>
            <p className="text-sm">
              An admin has hidden this image. It is not shown in the Shop or on
              your pages, and it can&apos;t be ordered or published.
            </p>
            <p className="text-sm">
              Questions:{" "}
              <a
                href={`mailto:${HELP_EMAIL}`}
                className="inline-flex min-h-11 items-center underline underline-offset-2"
              >
                {HELP_EMAIL}
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
