import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  assignExportFilenames,
  buildExportManifest,
  createDesignExportStream,
  exportArchiveName,
  exportObjectKey,
  MAX_EXPORT_IMAGES,
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
      included: [true, false],
      exportedAt: NOW,
    });
    expect(manifest).toEqual({
      exportedAt: "2026-09-28T03:00:00.000Z",
      timestampTimeZone: "UTC",
      filenameDateTimeZone: "America/Los_Angeles",
      imageCount: 2,
      includedCount: 1,
      missingCount: 1,
      images: [
        {
          imageId: "a",
          filename: "2026-09-20_a.png",
          included: true,
          operation: "edit",
          prompt: "prompt a",
          aspectRatio: "1:1",
          createdAt: "2026-09-20T12:00:00.000Z",
        },
        {
          imageId: "b",
          filename: null,
          included: false,
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

  it("throws a RangeError past MAX_EXPORT_IMAGES rows", () => {
    expect(MAX_EXPORT_IMAGES).toBe(65_534);
    const rows = Array.from({ length: MAX_EXPORT_IMAGES + 1 }, (_, i) => row(`r${i}`));
    expect(() =>
      createDesignExportStream({ rows, readObject: async () => null, keyFromUrl, now: NOW })
    ).toThrow(RangeError);
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
