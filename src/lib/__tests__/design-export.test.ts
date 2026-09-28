import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  assignExportFilenames,
  buildExportManifest,
  crc32,
  createDesignExportStream,
  dosDateTime,
  EXPORT_PART_MAX_BYTES,
  EXPORT_PART_MAX_IMAGES,
  EXPORT_REASON_SIZE_LIMIT,
  EXPORT_REASON_TIMEOUT,
  EXPORT_REASON_UNREADABLE,
  exportArchiveName,
  exportObjectKey,
  exportPartCount,
  exportPartRows,
  parseExportPart,
  summarizeExportParts,
  type ExportManifest,
  type ExportRow,
} from "@/lib/design-export";

function row(id: string, over: Partial<ExportRow> = {}): ExportRow {
  return {
    imageId: id,
    imageUrl: `https://r2.test/images/${id}.png`,
    r2Key: `images/${id}.png`,
    operation: "generate",
    prompt: `prompt ${id}`,
    aspectRatio: "1:1",
    createdAt: new Date("2026-09-20T12:00:00Z"),
    ...over,
  };
}

const keyFromUrl = (url: string) =>
  url.startsWith("https://r2.test/") ? url.slice("https://r2.test/".length) : null;

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

function bytesFor(id: string): Uint8Array {
  return new TextEncoder().encode(`bytes-of-${id}`.repeat(50));
}

/** Compression method of every central-directory entry. */
function centralMethods(zip: Uint8Array): number[] {
  const buf = Buffer.from(zip);
  const methods: number[] = [];
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50) methods.push(buf.readUInt16LE(i + 10));
  }
  return methods;
}

function testZip(zip: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "design-export-"));
  try {
    const file = join(dir, "out.zip");
    writeFileSync(file, zip);
    execFileSync("unzip", ["-tq", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NOW = new Date("2026-09-28T03:00:00Z");

describe("assignExportFilenames", () => {
  it("uses the Pacific calendar day across the UTC-midnight boundary", () => {
    const names = assignExportFilenames([
      row("a", { createdAt: new Date("2026-09-28T03:00:00Z") }),
      row("b", { createdAt: new Date("2026-09-28T07:30:00Z") }),
    ]);
    expect(names).toEqual(["2026-09-27_a.png", "2026-09-28_b.png"]);
  });

  it("sanitizes ids and keeps names unique", () => {
    const names = assignExportFilenames([
      row("a/b"),
      row("a_b"),
      row("a b"),
      row("a_b"),
    ]);
    expect(names).toEqual([
      "2026-09-20_a_b.png",
      "2026-09-20_a_b-2.png",
      "2026-09-20_a_b-3.png",
      "2026-09-20_a_b-4.png",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("assignExportFilenames case", () => {
  it("keeps names distinct when compared in lowercase", () => {
    const names = assignExportFilenames([row("Abc"), row("abc")]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2);
    expect(names[0]).toBe("2026-09-20_Abc.png");
    expect(names[1]).toBe("2026-09-20_abc-2.png");
  });
});

describe("exportArchiveName", () => {
  it("names the archive by Pacific day", () => {
    expect(exportArchiveName(NOW)).toBe("prntd-designs-2026-09-27.zip");
  });

  it("names one part like the whole library, and several parts by number", () => {
    expect(exportArchiveName(NOW, 1, 1)).toBe("prntd-designs-2026-09-27.zip");
    expect(exportArchiveName(NOW, 2, 3)).toBe(
      "prntd-designs-2026-09-27-part-2-of-3.zip"
    );
  });
});

describe("exportObjectKey", () => {
  it("prefers r2Key, falls back to the URL", () => {
    expect(exportObjectKey(row("a"), keyFromUrl)).toBe("images/a.png");
    expect(
      exportObjectKey(
        row("a", { r2Key: null, imageUrl: "https://r2.test/designs/d/1.png" }),
        keyFromUrl
      )
    ).toBe("designs/d/1.png");
    expect(
      exportObjectKey(row("a", { r2Key: null, imageUrl: "https://elsewhere/x.png" }), keyFromUrl)
    ).toBeNull();
  });
});

describe("buildExportManifest", () => {
  it("has the documented shape with UTC timestamps", () => {
    const rows = [
      row("a", { operation: "edit" }),
      row("b", { operation: null, prompt: null, aspectRatio: "3:4" }),
    ];
    const manifest = buildExportManifest({
      rows,
      filenames: assignExportFilenames(rows),
      reasons: [null, EXPORT_REASON_UNREADABLE],
      exportedAt: NOW,
      part: 2,
      partCount: 3,
    });
    expect(manifest).toEqual({
      exportedAt: "2026-09-28T03:00:00.000Z",
      timestampTimeZone: "UTC",
      filenameDateTimeZone: "America/Los_Angeles",
      part: 2,
      partCount: 3,
      partMaxImages: 100,
      imageCount: 2,
      includedCount: 1,
      missingCount: 1,
      images: [
        {
          imageId: "a",
          filename: "2026-09-20_a.png",
          included: true,
          reason: null,
          operation: "edit",
          prompt: "prompt a",
          aspectRatio: "1:1",
          createdAt: "2026-09-20T12:00:00.000Z",
        },
        {
          imageId: "b",
          filename: null,
          included: false,
          reason: "The image file could not be read from storage.",
          operation: null,
          prompt: null,
          aspectRatio: "3:4",
          createdAt: "2026-09-20T12:00:00.000Z",
        },
      ],
    });
    expect(manifest.exportedAt.endsWith("Z")).toBe(true);
  });
});

describe("createDesignExportStream", () => {
  it("produces a valid stored zip matching the manifest", async () => {
    const rows = [row("a"), row("b"), row("c/d")];
    const zip = await collect(
      createDesignExportStream({
        rows,
        readObject: async (key) => bytesFor(key),
        keyFromUrl,
        now: NOW,
      })
    );
    testZip(zip);

    const entries = unzipSync(zip);
    const manifest = JSON.parse(
      new TextDecoder().decode(entries["manifest.json"])
    ) as ExportManifest;
    const filenames = manifest.images.filter((i) => i.included).map((i) => i.filename!);
    expect(Object.keys(entries).sort()).toEqual([...filenames, "manifest.json"].sort());
    expect(manifest.includedCount).toBe(3);
    rows.forEach((r, i) => {
      expect(Buffer.from(entries[filenames[i]])).toEqual(
        Buffer.from(bytesFor(`images/${r.imageId}.png`))
      );
    });
    const methods = centralMethods(zip);
    expect(methods).toHaveLength(4);
    expect(methods.every((m) => m === 0)).toBe(true);
  });

  it("skips null reads, throwing reads and rows with no key", async () => {
    const errors: string[] = [];
    const spy = console.error;
    console.error = (msg: string) => errors.push(msg);
    try {
      const rows = [
        row("ok"),
        row("nullread"),
        row("throws"),
        row("nokey", { r2Key: null, imageUrl: "https://elsewhere/x.png" }),
      ];
      const zip = await collect(
        createDesignExportStream({
          rows,
          readObject: async (key) => {
            if (key.includes("nullread")) return null;
            if (key.includes("throws")) throw new Error("boom");
            return bytesFor(key);
          },
          keyFromUrl,
          now: NOW,
        })
      );
      testZip(zip);
      const entries = unzipSync(zip);
      const manifest = JSON.parse(
        new TextDecoder().decode(entries["manifest.json"])
      ) as ExportManifest;
      expect(manifest.images.map((i) => i.included)).toEqual([true, false, false, false]);
      expect(manifest.images.slice(1).every((i) => i.filename === null)).toBe(true);
      expect(manifest.images.map((i) => i.reason)).toEqual([
        null,
        EXPORT_REASON_UNREADABLE,
        EXPORT_REASON_UNREADABLE,
        EXPORT_REASON_UNREADABLE,
      ]);
      expect(manifest.missingCount).toBe(3);
      expect(Object.keys(entries).sort()).toEqual(
        ["2026-09-20_ok.png", "manifest.json"].sort()
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("throws");
      expect(errors[0]).toContain("boom");
    } finally {
      console.error = spy;
    }
  });

  it("reads one object at a time", async () => {
    let inFlight = 0;
    let max = 0;
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`));
    const zip = await collect(
      createDesignExportStream({
        rows,
        readObject: async (key) => {
          inFlight++;
          max = Math.max(max, inFlight);
          await new Promise((r) => setTimeout(r, 2));
          inFlight--;
          return bytesFor(key);
        },
        keyFromUrl,
        now: NOW,
      })
    );
    testZip(zip);
    expect(max).toBe(1);
  });

  it("does not read ahead of the consumer", async () => {
    let reads = 0;
    const stream = createDesignExportStream({
      rows: Array.from({ length: 5 }, (_, i) => row(`r${i}`)),
      readObject: async (key) => {
        reads++;
        return bytesFor(key);
      },
      keyFromUrl,
      now: NOW,
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toBeLessThanOrEqual(1);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toBeLessThanOrEqual(1);
  });

  it("reads image n+1 only after image n's bytes were consumed", async () => {
    const events: string[] = [];
    const stream = createDesignExportStream({
      rows: Array.from({ length: 5 }, (_, i) => row(`r${i}`)),
      readObject: async (key) => {
        events.push(`read:${key}`);
        return bytesFor(key);
      },
      keyFromUrl,
      now: NOW,
    });
    const reader = stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      events.push("chunk");
    }
    const readIdx = events.flatMap((e, i) => (e.startsWith("read:") ? [i] : []));
    expect(readIdx).toHaveLength(5);
    for (let k = 1; k < readIdx.length; k++) {
      const between = events.slice(readIdx[k - 1] + 1, readIdx[k]);
      expect(between).toContain("chunk");
    }
  });

  it("makes no second read while the consumer pauses after one chunk", async () => {
    const reads: string[] = [];
    const stream = createDesignExportStream({
      rows: Array.from({ length: 5 }, (_, i) => row(`r${i}`)),
      readObject: async (key) => {
        reads.push(key);
        return bytesFor(key);
      },
      keyFromUrl,
      now: NOW,
    });
    const reader = stream.getReader();
    await reader.read();
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toHaveLength(1);
    await reader.cancel();
  });

  it("stops cleanly when cancelled during an in-flight read", async () => {
    let resolveRead!: (b: Uint8Array) => void;
    const reads: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const stream = createDesignExportStream({
        rows: [row("a"), row("b"), row("c")],
        readObject: (key) => {
          reads.push(key);
          return new Promise<Uint8Array>((r) => {
            resolveRead = r;
          });
        },
        keyFromUrl,
        now: NOW,
      });
      const reader = stream.getReader();
      const firstRead = reader.read();
      await new Promise((r) => setTimeout(r, 10));
      expect(reads).toHaveLength(1);
      await reader.cancel();
      resolveRead(bytesFor("a"));
      await firstRead;
      await new Promise((r) => setTimeout(r, 20));
      expect(reads).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("makes a valid zip with only manifest.json for no rows", async () => {
    const zip = await collect(
      createDesignExportStream({
        rows: [],
        readObject: async () => null,
        keyFromUrl,
        now: NOW,
      })
    );
    testZip(zip);
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toEqual(["manifest.json"]);
    const manifest = JSON.parse(
      new TextDecoder().decode(entries["manifest.json"])
    ) as ExportManifest;
    expect(manifest.imageCount).toBe(0);
    expect(manifest.images).toEqual([]);
  });
});

describe("design-export.ts schema imports", () => {
  it("does not import listing, product or order tables", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/design-export.ts"),
      "utf8"
    );
    const imports = source.match(/import[^;]*?from\s+["'][^"']+["'];/g) ?? [];
    const schemaImports = imports.filter((s) => s.includes("@/lib/db/schema")).join("\n");
    expect(schemaImports).toContain("image");
    expect(schemaImports).not.toMatch(/\b(listing|product|order|orderItem|order_item)\b/);
    expect(imports.join("\n")).not.toMatch(/user-designs|composition-reads/);
  });
});

describe("export parts", () => {
  it("has the documented limits", () => {
    expect(EXPORT_PART_MAX_IMAGES).toBe(100);
    expect(EXPORT_PART_MAX_BYTES).toBe(400 * 1024 * 1024);
  });

  it("counts parts of 100, at least one", () => {
    expect(exportPartCount(0)).toBe(1);
    expect(exportPartCount(1)).toBe(1);
    expect(exportPartCount(100)).toBe(1);
    expect(exportPartCount(101)).toBe(2);
    expect(exportPartCount(250)).toBe(3);
  });

  it("slices a 1-based part", () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    expect(exportPartRows(rows, 1)).toEqual(rows.slice(0, 100));
    expect(exportPartRows(rows, 2)).toEqual(rows.slice(100, 200));
    expect(exportPartRows(rows, 3)).toEqual(rows.slice(200, 250));
    expect(exportPartRows(rows, 4)).toEqual([]);
  });

  it("summarizes each part's count and date range", () => {
    const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
    const rows = Array.from({ length: 150 }, (_, i) => ({ createdAt: day(i) }));
    expect(summarizeExportParts(rows)).toEqual([
      { part: 1, partCount: 2, count: 100, firstCreatedAt: day(0), lastCreatedAt: day(99) },
      { part: 2, partCount: 2, count: 50, firstCreatedAt: day(100), lastCreatedAt: day(149) },
    ]);
    expect(summarizeExportParts([])).toEqual([]);
  });

  it("parses the part parameter", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(parseExportPart(q(""), 3)).toEqual({ ok: true, part: 1 });
    expect(parseExportPart(q("part=1"), 3)).toEqual({ ok: true, part: 1 });
    expect(parseExportPart(q("part=3"), 3)).toEqual({ ok: true, part: 3 });
    expect(parseExportPart(q("part=4"), 3)).toEqual({ ok: false, status: 404 });
    expect(parseExportPart(q("part=999999"), 3)).toEqual({ ok: false, status: 404 });
    for (const bad of [
      "part=",
      "part=0",
      "part=01",
      "part=-1",
      "part=1.5",
      "part=abc",
      "part=1e2",
      "part=%201",
      "part=1234567",
      "part=1&part=2",
      "part=1&part=1",
    ]) {
      expect(parseExportPart(q(bad), 3), bad).toEqual({ ok: false, status: 400 });
    }
  });
});

type LocalEntry = {
  name: string;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  data: Uint8Array;
};

/** Walk the local file headers from offset 0, using each header's lengths. */
function localEntries(zip: Uint8Array): LocalEntry[] {
  const buf = Buffer.from(zip);
  const out: LocalEntry[] = [];
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const compressedSize = buf.readUInt32LE(p + 18);
    const dataStart = p + 30 + nameLen + extraLen;
    out.push({
      name: buf.subarray(p + 30, p + 30 + nameLen).toString("latin1"),
      flags: buf.readUInt16LE(p + 6),
      method: buf.readUInt16LE(p + 8),
      time: buf.readUInt16LE(p + 10),
      date: buf.readUInt16LE(p + 12),
      crc: buf.readUInt32LE(p + 14),
      compressedSize,
      size: buf.readUInt32LE(p + 22),
      offset: p,
      data: new Uint8Array(buf.subarray(dataStart, dataStart + compressedSize)),
    });
    p = dataStart + compressedSize;
  }
  return out;
}

type CentralEntry = Omit<LocalEntry, "data" | "offset"> & {
  madeBy: number;
  externalAttrs: number;
  localOffset: number;
};

/** The central directory, located through the end-of-central-directory record. */
function centralEntries(zip: Uint8Array): { entries: CentralEntry[]; eocd: { count: number; cdSize: number; cdOffset: number; eocdAt: number } } {
  const buf = Buffer.from(zip);
  const eocdAt = buf.length - 22;
  expect(buf.readUInt32LE(eocdAt)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocdAt + 10);
  const cdSize = buf.readUInt32LE(eocdAt + 12);
  const cdOffset = buf.readUInt32LE(eocdAt + 16);
  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.push({
      madeBy: buf.readUInt16LE(p + 4),
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      externalAttrs: buf.readUInt32LE(p + 38),
      localOffset: buf.readUInt32LE(p + 42),
      name: buf.subarray(p + 46, p + 46 + nameLen).toString("latin1"),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, eocd: { count, cdSize, cdOffset, eocdAt } };
}

/** Decode DOS date/time fields to "YYYY-MM-DD HH:MM:SS". */
function decodeDos(date: number, time: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = (date >> 9) + 1980;
  const mo = (date >> 5) & 0xf;
  const d = date & 0x1f;
  const h = time >> 11;
  const mi = (time >> 5) & 0x3f;
  const s = (time & 0x1f) * 2;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

function manifestOf(zip: Uint8Array): ExportManifest {
  return JSON.parse(new TextDecoder().decode(unzipSync(zip)["manifest.json"]));
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zip writer", () => {
  it("puts CRC and sizes in every local header, with no data descriptors", async () => {
    const rows = [row("a"), row("b"), row("c")];
    const zip = await collect(
      createDesignExportStream({
        rows,
        readObject: async (key) => bytesFor(key),
        keyFromUrl,
        now: NOW,
      })
    );
    testZip(zip);
    const locals = localEntries(zip);
    expect(locals.map((e) => e.name)).toEqual([
      "2026-09-20_a.png",
      "2026-09-20_b.png",
      "2026-09-20_c.png",
      "manifest.json",
    ]);
    const sources = [
      ...rows.map((r) => bytesFor(`images/${r.imageId}.png`)),
      unzipSync(zip)["manifest.json"],
    ];
    locals.forEach((e, i) => {
      expect(e.flags & 0x8).toBe(0);
      expect(e.flags).toBe(0);
      expect(e.method).toBe(0);
      expect(e.crc).not.toBe(0);
      expect(e.size).toBeGreaterThan(0);
      expect(e.crc).toBe(crc32(sources[i]));
      expect(e.size).toBe(sources[i].length);
      expect(e.compressedSize).toBe(sources[i].length);
      expect(Buffer.from(e.data)).toEqual(Buffer.from(sources[i]));
    });

    const { entries, eocd } = centralEntries(zip);
    expect(eocd.count).toBe(4);
    // The central directory starts right after the last entry's data.
    const last = locals[locals.length - 1];
    expect(eocd.cdOffset).toBe(last.offset + 30 + last.name.length + last.size);
    expect(eocd.cdOffset + eocd.cdSize).toBe(eocd.eocdAt);
    entries.forEach((c, i) => {
      const l = locals[i];
      expect(c).toMatchObject({
        name: l.name,
        flags: 0,
        method: 0,
        time: l.time,
        date: l.date,
        crc: l.crc,
        compressedSize: l.size,
        size: l.size,
        localOffset: l.offset,
        madeBy: 0x0314,
        externalAttrs: (0o100644 << 16) >>> 0,
      });
    });
  });

  it("stores file times as the Pacific wall clock", async () => {
    const times: [string, string][] = [
      ["2026-09-28T03:00:00Z", "2026-09-27 20:00:00"],
      ["2026-03-08T09:59:58Z", "2026-03-08 01:59:58"],
      ["2026-03-08T10:00:00Z", "2026-03-08 03:00:00"],
      ["2026-11-01T08:30:00Z", "2026-11-01 01:30:00"],
      ["2026-11-01T09:30:00Z", "2026-11-01 01:30:00"],
      ["2026-07-04T19:00:01Z", "2026-07-04 12:00:00"],
    ];
    const rows = times.map(([iso], i) => row(`t${i}`, { createdAt: new Date(iso) }));
    const zip = await collect(
      createDesignExportStream({
        rows,
        readObject: async (key) => bytesFor(key),
        keyFromUrl,
        now: NOW,
      })
    );
    const locals = localEntries(zip);
    times.forEach(([, wall], i) => {
      const e = locals[i];
      expect(decodeDos(e.date, e.time)).toBe(wall);
      // The DOS date agrees with the Pacific date in the filename.
      expect(e.name.slice(0, 10)).toBe(wall.slice(0, 10));
      expect(Number(decodeDos(e.date, e.time).slice(-2)) % 2).toBe(0);
    });
    const manifestEntry = locals[locals.length - 1];
    expect(manifestEntry.name).toBe("manifest.json");
    expect(decodeDos(manifestEntry.date, manifestEntry.time)).toBe("2026-09-27 20:00:00");
  });

  it("clamps times before 1980 to the DOS epoch", () => {
    expect(dosDateTime(new Date("1970-01-01T12:00:00Z"))).toEqual({
      date: (1 << 5) | 1,
      time: 0,
    });
  });

  it("reads no object until the consumer reads", async () => {
    let reads = 0;
    const stream = createDesignExportStream({
      rows: [row("a"), row("b")],
      readObject: async (key) => {
        reads++;
        return bytesFor(key);
      },
      keyFromUrl,
      now: NOW,
    });
    for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
    expect(reads).toBe(0);
    const reader = stream.getReader();
    await new Promise((r) => setTimeout(r, 10));
    expect(reads).toBe(0);
    await reader.read();
    expect(reads).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(reads).toBe(1);
    await reader.cancel();
  });
});

describe("createDesignExportStream reasons and limits", () => {
  it("lists a timed-out read with the timeout reason and carries on", async () => {
    const spy = console.error;
    console.error = () => {};
    try {
      const zip = await collect(
        createDesignExportStream({
          rows: [row("a"), row("slow"), row("c")],
          readObject: async (key) => {
            if (key.includes("slow")) {
              const err = new Error("R2 read timed out");
              err.name = "TimeoutError";
              throw err;
            }
            return bytesFor(key);
          },
          keyFromUrl,
          now: NOW,
        })
      );
      testZip(zip);
      const manifest = manifestOf(zip);
      expect(manifest.images.map((i) => [i.imageId, i.included, i.reason])).toEqual([
        ["a", true, null],
        ["slow", false, EXPORT_REASON_TIMEOUT],
        ["c", true, null],
      ]);
      expect(EXPORT_REASON_TIMEOUT).toBe("Reading the image file from storage timed out.");
    } finally {
      console.error = spy;
    }
  });

  it("stops at the byte limit, leaves the rest unread, and still closes the zip", async () => {
    const reads: string[] = [];
    const size = bytesFor("images/r0.png").length;
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`));
    const zip = await collect(
      createDesignExportStream({
        rows,
        readObject: async (key) => {
          reads.push(key);
          return bytesFor(key);
        },
        keyFromUrl,
        now: NOW,
        part: 2,
        partCount: 3,
        // Room for exactly two images.
        maxBytes: size * 2 + 1,
      })
    );
    testZip(zip);
    // The third object is read (its size is only known then); none after it.
    expect(reads).toEqual(["images/r0.png", "images/r1.png", "images/r2.png"]);
    const manifest = manifestOf(zip);
    expect(manifest).toMatchObject({
      part: 2,
      partCount: 3,
      partMaxImages: 100,
      imageCount: 6,
      includedCount: 2,
      missingCount: 4,
    });
    expect(manifest.images.map((i) => i.reason)).toEqual([
      null,
      null,
      ...Array(4).fill(EXPORT_REASON_SIZE_LIMIT),
    ]);
    expect(manifest.images.slice(2).every((i) => !i.included && i.filename === null)).toBe(
      true
    );
    expect(EXPORT_REASON_SIZE_LIMIT).toBe(
      "Left out: this file reached its 400 MB size limit. Download this image from its page in My Designs."
    );
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(
      ["2026-09-20_r0.png", "2026-09-20_r1.png", "manifest.json"].sort()
    );
  });

  it("leaves out a first image that alone is over the limit", async () => {
    const zip = await collect(
      createDesignExportStream({
        rows: [row("big"), row("b")],
        readObject: async (key) => bytesFor(key),
        keyFromUrl,
        now: NOW,
        maxBytes: 10,
      })
    );
    testZip(zip);
    expect(manifestOf(zip).images.map((i) => i.reason)).toEqual([
      EXPORT_REASON_SIZE_LIMIT,
      EXPORT_REASON_SIZE_LIMIT,
    ]);
    expect(Object.keys(unzipSync(zip))).toEqual(["manifest.json"]);
  });

  it("names its part in the manifest", async () => {
    const zip = await collect(
      createDesignExportStream({
        rows: [row("a")],
        readObject: async (key) => bytesFor(key),
        keyFromUrl,
        now: NOW,
      })
    );
    expect(manifestOf(zip)).toMatchObject({ part: 1, partCount: 1, partMaxImages: 100 });
  });
});
