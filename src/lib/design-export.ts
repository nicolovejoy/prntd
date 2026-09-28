/**
 * "Download all my designs": the rows to export, their filenames, the
 * manifest, and the streamed zip.
 *
 * Images are stored in the zip uncompressed (PNGs don't shrink). fflate's
 * streaming zip writes data descriptors (sizes after the data) and has no
 * ZIP64, so an archive is limited to 4 GiB and 65,535 entries (the images
 * plus manifest.json); `MAX_EXPORT_IMAGES` is the image-count limit.
 *
 * Rows come from the `image` table alone; publication and order state are
 * not part of an export.
 */
import { desc, eq, sql } from "drizzle-orm";
import { Zip, ZipPassThrough } from "fflate";
import type { db as appDb } from "@/lib/db";
import { image as imageTable } from "@/lib/db/schema";

const FILENAME_TIME_ZONE = "America/Los_Angeles";

/** Most images one archive can hold: 65,535 entries minus manifest.json. */
export const MAX_EXPORT_IMAGES = 65_534;

export type ExportRow = {
  imageId: string;
  imageUrl: string;
  r2Key: string | null;
  operation: "generate" | "edit" | "upload" | null;
  prompt: string | null;
  aspectRatio: string;
  createdAt: Date;
};

/**
 * Every image the user owns, newest first. Same filter and order as
 * `getUserImageLibrary` (My Designs), so the export matches the grid.
 */
export async function loadExportRows(
  db: typeof appDb,
  userId: string,
): Promise<ExportRow[]> {
  return (
    db
      .select({
        imageId: imageTable.id,
        imageUrl: imageTable.imageUrl,
        r2Key: imageTable.r2Key,
        operation: imageTable.operation,
        prompt: imageTable.prompt,
        aspectRatio: imageTable.aspectRatio,
        createdAt: imageTable.createdAt,
      })
      .from(imageTable)
      .where(eq(imageTable.ownerId, userId))
      // created_at has seconds resolution; rowid breaks same-second ties.
      .orderBy(desc(imageTable.createdAt), sql`image.rowid desc`)
  );
}

/** The R2 key for a row: the stored key, else the one in its public URL. */
export function exportObjectKey(
  row: Pick<ExportRow, "r2Key" | "imageUrl">,
  keyFromUrl: (url: string) => string | null,
): string | null {
  return row.r2Key ?? keyFromUrl(row.imageUrl);
}

/** Calendar day (YYYY-MM-DD) of an instant in Pacific time. */
function pacificDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FILENAME_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * `<YYYY-MM-DD>_<id>.png` per row, parallel to `rows`. The date is the
 * created day in Pacific time; the id is restricted to `[A-Za-z0-9_-]`.
 * A name that collides with an earlier one, ignoring case (macOS and Windows
 * extract case-insensitively), gets `-2`, `-3`, … before `.png`.
 */
export function assignExportFilenames(
  rows: Pick<ExportRow, "imageId" | "createdAt">[],
): string[] {
  const used = new Set<string>();
  return rows.map((row) => {
    const base = `${pacificDay(row.createdAt)}_${row.imageId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    let name = `${base}.png`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}.png`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** `prntd-designs-<Pacific YYYY-MM-DD>.zip` */
export function exportArchiveName(now: Date): string {
  return `prntd-designs-${pacificDay(now)}.zip`;
}

export type ExportManifest = {
  exportedAt: string;
  timestampTimeZone: "UTC";
  filenameDateTimeZone: typeof FILENAME_TIME_ZONE;
  imageCount: number;
  includedCount: number;
  missingCount: number;
  images: {
    imageId: string;
    filename: string | null;
    included: boolean;
    operation: ExportRow["operation"];
    prompt: string | null;
    aspectRatio: string;
    createdAt: string;
  }[];
};

/**
 * The manifest.json contents. Timestamps are UTC ISO 8601; `included: false`
 * marks an image whose object could not be read, with `filename: null`.
 */
export function buildExportManifest(params: {
  rows: ExportRow[];
  filenames: string[];
  included: boolean[];
  exportedAt: Date;
}): ExportManifest {
  const { rows, filenames, included, exportedAt } = params;
  const includedCount = included.filter(Boolean).length;
  return {
    exportedAt: exportedAt.toISOString(),
    timestampTimeZone: "UTC",
    filenameDateTimeZone: FILENAME_TIME_ZONE,
    imageCount: rows.length,
    includedCount,
    missingCount: rows.length - includedCount,
    images: rows.map((row, i) => ({
      imageId: row.imageId,
      filename: included[i] ? filenames[i] : null,
      included: included[i],
      operation: row.operation,
      prompt: row.prompt,
      aspectRatio: row.aspectRatio,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * A zip of the rows' image objects plus manifest.json, as a pull-based stream.
 * Each pull reads one object and enqueues its zip bytes before the next read,
 * so at most one image is held in memory. An object that is absent, has no
 * key, or fails to read is skipped and listed as missing in the manifest.
 * Cancelling the stream stops any further reads. Throws a RangeError when
 * there are more than `MAX_EXPORT_IMAGES` rows.
 */
export function createDesignExportStream(params: {
  rows: ExportRow[];
  readObject: (key: string) => Promise<Uint8Array | Buffer | null>;
  keyFromUrl: (url: string) => string | null;
  now: Date;
}): ReadableStream<Uint8Array> {
  const { rows, readObject, keyFromUrl, now } = params;
  if (rows.length > MAX_EXPORT_IMAGES) {
    throw new RangeError(
      `design export: ${rows.length} images exceeds the ${MAX_EXPORT_IMAGES} limit`,
    );
  }
  const filenames = assignExportFilenames(rows);
  const included: boolean[] = rows.map(() => false);

  let pending: Uint8Array[] = [];
  let zipError: Error | null = null;
  let done = false;
  let next = 0;
  let cancelled = false;
  let enqueued = false;

  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else pending.push(chunk);
  });

  const drain = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunks = pending;
    pending = [];
    for (const chunk of chunks) controller.enqueue(chunk);
    enqueued = chunks.length > 0;
  };

  const addFile = (name: string, bytes: Uint8Array, mtime: Date) => {
    const file = new ZipPassThrough(name);
    file.mtime = mtime;
    zip.add(file);
    file.push(bytes, true);
  };

  const fail = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    err: unknown,
  ) => {
    cancelled = true;
    pending = [];
    zip.terminate();
    controller.error(err);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A skipped (missing) image produces no bytes; keep going until this
        // pull enqueues something or the archive ends, since a pull that
        // enqueues nothing is not called again.
        do {
          if (done || cancelled) return;
          if (next < rows.length) {
            const i = next++;
            const row = rows[i];
            const key = exportObjectKey(row, keyFromUrl);
            let bytes: Uint8Array | null = null;
            if (key) {
              try {
                bytes = await readObject(key);
              } catch (err) {
                console.error(
                  `design export: read failed for image ${row.imageId}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
            if (cancelled) return;
            if (bytes) {
              included[i] = true;
              addFile(filenames[i], bytes, row.createdAt);
            }
          } else {
            const manifest = buildExportManifest({
              rows,
              filenames,
              included,
              exportedAt: now,
            });
            addFile(
              "manifest.json",
              new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
              now,
            );
            zip.end();
            done = true;
          }
          if (zipError) {
            fail(controller, zipError);
            return;
          }
          drain(controller);
        } while (!done && !cancelled && !enqueued);
        if (done) controller.close();
      } catch (err) {
        fail(controller, err);
      }
    },
    cancel() {
      cancelled = true;
      pending = [];
      zip.terminate();
    },
  });
}
