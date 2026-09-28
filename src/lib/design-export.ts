/**
 * "Download all my designs": the rows to export, how they split into parts,
 * their filenames, the manifest, and the streamed zip.
 *
 * Parts: the user's images, oldest first, split into zips of at most
 * `EXPORT_PART_MAX_IMAGES` images. Oldest first means new designs made
 * between downloads only extend the last part; parts before it keep the same
 * images. Inside a part, a running byte total stops adding images at
 * `EXPORT_PART_MAX_BYTES`; the rest of that part is listed in the manifest as
 * left out, with a reason.
 *
 * The zip writer is local: stored entries only (method 0, PNGs don't shrink),
 * with CRC-32 and sizes in each local header and no data descriptors (flag
 * bit 3 clear), which strict streaming readers require. Each image is fully
 * read before its entry is written, so the sizes are known up front. No ZIP64:
 * a part holds at most 101 entries and about 400 MB, far under the 65,535
 * entry and 4 GiB limits; the writer throws if either would be exceeded.
 *
 * In-zip file times are the image's created time as a Pacific wall clock
 * (DOS time has no zone), so they agree with the Pacific date in the
 * filename whatever the server's TZ. manifest.json keeps UTC ISO 8601.
 *
 * Rows come from the `image` table alone; publication and order state are
 * not part of an export.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/lib/db";
import { image as imageTable } from "@/lib/db/schema";

const FILENAME_TIME_ZONE = "America/Los_Angeles";

/** Most images in one part (one zip). */
export const EXPORT_PART_MAX_IMAGES = 100;
/** Most image bytes in one part; images past it are left out of that zip. */
export const EXPORT_PART_MAX_BYTES = 400 * 1024 * 1024;

export const EXPORT_REASON_UNREADABLE =
  "The image file could not be read from storage.";
export const EXPORT_REASON_TIMEOUT =
  "Reading the image file from storage timed out.";
export const EXPORT_REASON_SIZE_LIMIT =
  "Left out: this file reached its 400 MB size limit. Download this image from its page in My Designs.";

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
 * Every image the user owns, oldest first. Same filter as
 * `getUserImageLibrary` (My Designs) and exactly its order reversed, so the
 * page can compute the parts from the library it already loaded.
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
      .orderBy(asc(imageTable.createdAt), sql`image.rowid asc`)
  );
}

/** Number of parts for a library of `rowCount` images; at least 1. */
export function exportPartCount(rowCount: number): number {
  return Math.max(1, Math.ceil(rowCount / EXPORT_PART_MAX_IMAGES));
}

/** The rows of a 1-based part. */
export function exportPartRows<T>(rows: T[], part: number): T[] {
  const start = (part - 1) * EXPORT_PART_MAX_IMAGES;
  return rows.slice(start, start + EXPORT_PART_MAX_IMAGES);
}

export type ExportPartSummary = {
  part: number;
  partCount: number;
  count: number;
  firstCreatedAt: Date;
  lastCreatedAt: Date;
};

/** One summary per part of an oldest-first list; [] for no rows. */
export function summarizeExportParts(
  rowsOldestFirst: { createdAt: Date }[],
): ExportPartSummary[] {
  if (rowsOldestFirst.length === 0) return [];
  const partCount = exportPartCount(rowsOldestFirst.length);
  return Array.from({ length: partCount }, (_, i) => {
    const rows = exportPartRows(rowsOldestFirst, i + 1);
    return {
      part: i + 1,
      partCount,
      count: rows.length,
      firstCreatedAt: rows[0].createdAt,
      lastCreatedAt: rows[rows.length - 1].createdAt,
    };
  });
}

/**
 * The `part` query parameter. Absent → part 1. Repeated, empty or not a
 * plain positive integer → 400; a number past the last part → 404.
 */
export function parseExportPart(
  params: URLSearchParams,
  partCount: number,
): { ok: true; part: number } | { ok: false; status: 400 | 404 } {
  const values = params.getAll("part");
  if (values.length === 0) return { ok: true, part: 1 };
  if (values.length > 1 || !/^[1-9][0-9]{0,5}$/.test(values[0])) {
    return { ok: false, status: 400 };
  }
  const part = Number(values[0]);
  if (part > partCount) return { ok: false, status: 404 };
  return { ok: true, part };
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

const pacificClock = new Intl.DateTimeFormat("en-US", {
  timeZone: FILENAME_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/**
 * MS-DOS date and time fields for an instant, as a Pacific wall clock.
 * Seconds are stored at 2 s resolution. Before 1980 (DOS's epoch) clamps to
 * 1980-01-01 00:00:00.
 */
export function dosDateTime(date: Date): { date: number; time: number } {
  const p: Record<string, number> = {};
  for (const part of pacificClock.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  if (p.year < 1980) return { date: (1 << 5) | 1, time: 0 };
  return {
    date: ((p.year - 1980) << 9) | (p.month << 5) | p.day,
    time: (p.hour << 11) | (p.minute << 5) | (p.second >> 1),
  };
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

/**
 * `prntd-designs-<Pacific YYYY-MM-DD>.zip`, or
 * `prntd-designs-<Pacific YYYY-MM-DD>-part-<N>-of-<M>.zip` when there is
 * more than one part.
 */
export function exportArchiveName(now: Date, part = 1, partCount = 1): string {
  const suffix = partCount > 1 ? `-part-${part}-of-${partCount}` : "";
  return `prntd-designs-${pacificDay(now)}${suffix}.zip`;
}

export type ExportManifest = {
  exportedAt: string;
  timestampTimeZone: "UTC";
  filenameDateTimeZone: typeof FILENAME_TIME_ZONE;
  part: number;
  partCount: number;
  partMaxImages: number;
  imageCount: number;
  includedCount: number;
  missingCount: number;
  images: {
    imageId: string;
    filename: string | null;
    included: boolean;
    reason: string | null;
    operation: ExportRow["operation"];
    prompt: string | null;
    aspectRatio: string;
    createdAt: string;
  }[];
};

/**
 * The manifest.json contents for one part. Timestamps are UTC ISO 8601.
 * `reasons[i]` is null for an included image; otherwise the image is listed
 * with `included: false`, `filename: null` and that reason.
 */
export function buildExportManifest(params: {
  rows: ExportRow[];
  filenames: string[];
  reasons: (string | null)[];
  exportedAt: Date;
  part?: number;
  partCount?: number;
}): ExportManifest {
  const { rows, filenames, reasons, exportedAt, part = 1, partCount = 1 } = params;
  const includedCount = reasons.filter((r) => r === null).length;
  return {
    exportedAt: exportedAt.toISOString(),
    timestampTimeZone: "UTC",
    filenameDateTimeZone: FILENAME_TIME_ZONE,
    part,
    partCount,
    partMaxImages: EXPORT_PART_MAX_IMAGES,
    imageCount: rows.length,
    includedCount,
    missingCount: rows.length - includedCount,
    images: rows.map((row, i) => ({
      imageId: row.imageId,
      filename: reasons[i] === null ? filenames[i] : null,
      included: reasons[i] === null,
      reason: reasons[i],
      operation: row.operation,
      prompt: row.prompt,
      aspectRatio: row.aspectRatio,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, the zip checksum). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A value that must fit a zip32 field; the byte guard keeps parts far below. */
function u32(n: number): number {
  if (n > 0xffffffff) throw new RangeError(`design export: ${n} exceeds zip32`);
  return n;
}

type ZipEntry = {
  name: Uint8Array;
  crc: number;
  size: number;
  date: number;
  time: number;
  offset: number;
};

function localHeader(e: ZipEntry): Uint8Array {
  const buf = new Uint8Array(30 + e.name.length);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true); // version needed: 2.0
  v.setUint16(6, 0, true); // flags: no data descriptor, names not UTF-8
  v.setUint16(8, 0, true); // method: stored
  v.setUint16(10, e.time, true);
  v.setUint16(12, e.date, true);
  v.setUint32(14, e.crc, true);
  v.setUint32(18, u32(e.size), true); // compressed size
  v.setUint32(22, u32(e.size), true); // uncompressed size
  v.setUint16(26, e.name.length, true);
  v.setUint16(28, 0, true); // extra length
  buf.set(e.name, 30);
  return buf;
}

/** Central directory entries followed by the end-of-central-directory record. */
function centralDirectory(entries: ZipEntry[], cdOffset: number): Uint8Array {
  if (entries.length > 0xffff) {
    throw new RangeError(`design export: ${entries.length} entries exceeds zip32`);
  }
  const cdSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const buf = new Uint8Array(cdSize + 22);
  const v = new DataView(buf.buffer);
  let p = 0;
  for (const e of entries) {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, 0x0314, true); // made by: Unix, 2.0
    v.setUint16(p + 6, 20, true); // version needed: 2.0
    v.setUint16(p + 8, 0, true); // flags
    v.setUint16(p + 10, 0, true); // method: stored
    v.setUint16(p + 12, e.time, true);
    v.setUint16(p + 14, e.date, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, u32(e.size), true);
    v.setUint32(p + 24, u32(e.size), true);
    v.setUint16(p + 28, e.name.length, true);
    v.setUint16(p + 30, 0, true); // extra length
    v.setUint16(p + 32, 0, true); // comment length
    v.setUint16(p + 34, 0, true); // disk number start
    v.setUint16(p + 36, 0, true); // internal attributes
    v.setUint32(p + 38, (0o100644 << 16) >>> 0, true); // regular file, rw-r--r--
    v.setUint32(p + 42, u32(e.offset), true);
    buf.set(e.name, p + 46);
    p += 46 + e.name.length;
  }
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 4, 0, true); // this disk
  v.setUint16(p + 6, 0, true); // disk with the central directory
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, u32(cdSize), true);
  v.setUint32(p + 16, u32(cdOffset), true);
  v.setUint16(p + 20, 0, true); // comment length
  return buf;
}

/**
 * One part's zip: the rows' image objects plus manifest.json, as a pull-based
 * stream with a high-water mark of 0, so nothing is read until the consumer
 * asks (a HEAD request, which Next answers by calling GET and discarding the
 * body, reads no object). Each pull reads one object and enqueues its entry
 * before the next read, so at most one image is held in memory. An object
 * that is absent, has no key, or fails to read is listed as not included,
 * with a reason; a read that throws a `TimeoutError` gets the timeout reason.
 * Once the next image would take the part past `maxBytes`, it and every
 * remaining row are listed as left out and not read. Cancelling the stream
 * stops any further reads.
 */
export function createDesignExportStream(params: {
  rows: ExportRow[];
  readObject: (key: string) => Promise<Uint8Array | Buffer | null>;
  keyFromUrl: (url: string) => string | null;
  now: Date;
  part?: number;
  partCount?: number;
  maxBytes?: number;
}): ReadableStream<Uint8Array> {
  const {
    rows,
    readObject,
    keyFromUrl,
    now,
    part = 1,
    partCount = 1,
    maxBytes = EXPORT_PART_MAX_BYTES,
  } = params;
  const filenames = assignExportFilenames(rows);
  const reasons: (string | null)[] = rows.map(() => EXPORT_REASON_UNREADABLE);
  const entries: ZipEntry[] = [];
  const encoder = new TextEncoder();

  let offset = 0;
  let imageBytes = 0;
  let next = 0;
  let done = false;
  let cancelled = false;

  const addEntry = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    name: string,
    bytes: Uint8Array,
    mtime: Date,
  ) => {
    const entry: ZipEntry = {
      name: encoder.encode(name),
      crc: crc32(bytes),
      size: bytes.length,
      ...dosDateTime(mtime),
      offset,
    };
    const header = localHeader(entry);
    entries.push(entry);
    controller.enqueue(header);
    controller.enqueue(bytes);
    offset = u32(offset + header.length + bytes.length);
  };

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const manifest = buildExportManifest({
      rows,
      filenames,
      reasons,
      exportedAt: now,
      part,
      partCount,
    });
    addEntry(
      controller,
      "manifest.json",
      encoder.encode(JSON.stringify(manifest, null, 2)),
      now,
    );
    controller.enqueue(centralDirectory(entries, offset));
    done = true;
    controller.close();
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          // A row that is left out produces no bytes; keep going until this
          // pull enqueues something, since a pull that enqueues nothing is
          // not called again.
          for (;;) {
            if (done || cancelled) return;
            if (next >= rows.length) {
              finish(controller);
              return;
            }
            const i = next++;
            const row = rows[i];
            const key = exportObjectKey(row, keyFromUrl);
            let bytes: Uint8Array | null = null;
            if (key) {
              try {
                bytes = await readObject(key);
              } catch (err) {
                if (err instanceof Error && err.name === "TimeoutError") {
                  reasons[i] = EXPORT_REASON_TIMEOUT;
                }
                console.error(
                  `design export: read failed for image ${row.imageId}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
            if (cancelled) return;
            if (!bytes) continue;
            if (imageBytes + bytes.length > maxBytes) {
              // Past the part's byte limit: leave this and every later row
              // out without reading them, and close the archive.
              for (let j = i; j < rows.length; j++) {
                reasons[j] = EXPORT_REASON_SIZE_LIMIT;
              }
              next = rows.length;
              finish(controller);
              return;
            }
            imageBytes += bytes.length;
            reasons[i] = null;
            addEntry(controller, filenames[i], bytes, row.createdAt);
            return;
          }
        } catch (err) {
          cancelled = true;
          controller.error(err);
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
}
