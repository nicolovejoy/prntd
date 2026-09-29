import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDesignExportStream, type ExportRow } from "@/lib/design-export";

// In-zip times are the Pacific wall clock whatever the process time zone. This
// file pins the process to Asia/Tokyo, so a regression to Date's local getters
// fails here on any machine (on a Pacific laptop it would pass unnoticed).

const previousTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Asia/Tokyo";
});

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

function row(id: string, createdAt: string): ExportRow {
  return {
    imageId: id,
    imageUrl: `https://r2.test/images/${id}.png`,
    r2Key: `images/${id}.png`,
    operation: "generate",
    prompt: null,
    aspectRatio: "1:1",
    createdAt: new Date(createdAt),
  };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** DOS time and date of each local header, decoded to "YYYY-MM-DD HH:MM:SS". */
function localTimes(zip: Buffer): { name: string; wall: string }[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const out: { name: string; wall: string }[] = [];
  let p = 0;
  while (zip.readUInt32LE(p) === 0x04034b50) {
    const time = zip.readUInt16LE(p + 10);
    const date = zip.readUInt16LE(p + 12);
    const size = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const extraLen = zip.readUInt16LE(p + 28);
    out.push({
      name: zip.subarray(p + 30, p + 30 + nameLen).toString("latin1"),
      wall: `${(date >> 9) + 1980}-${pad((date >> 5) & 0xf)}-${pad(date & 0x1f)} ${pad(time >> 11)}:${pad((time >> 5) & 0x3f)}:${pad((time & 0x1f) * 2)}`,
    });
    p += 30 + nameLen + extraLen + size;
  }
  return out;
}

describe("in-zip times with the process in Asia/Tokyo", () => {
  it("stores the Pacific wall clock, not the process's", async () => {
    // The zone took effect: 03:00 UTC is 12:00 in Tokyo.
    expect(new Date("2026-09-28T03:00:00Z").getHours()).toBe(12);

    const cases: [string, string][] = [
      ["2026-09-28T03:00:00Z", "2026-09-27 20:00:00"], // PDT
      ["2026-01-15T03:00:00Z", "2026-01-14 19:00:00"], // PST
      ["2026-03-08T10:00:00Z", "2026-03-08 03:00:00"], // just after spring-forward
    ];
    const rows = cases.map(([iso], i) => row(`t${i}`, iso));
    const zip = await collect(
      createDesignExportStream({
        rows,
        readObject: async () => new Uint8Array([1, 2, 3]),
        keyFromUrl: () => null,
        now: new Date("2026-09-28T03:00:00Z"),
      })
    );
    const times = localTimes(zip);
    expect(times.map((t) => t.wall)).toEqual([
      ...cases.map(([, wall]) => wall),
      "2026-09-27 20:00:00", // manifest.json, from `now`
    ]);
    expect(times[times.length - 1].name).toBe("manifest.json");
  });
});
