/**
 * R2_DRY_RUN (#351): uploadImageObject skips the PutObject and still returns
 * the object's public URL, so the e2e runs (fake R2 credentials) can store an
 * image's rows. Unset or anything but "true" writes as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      send(...args: unknown[]) {
        return h.send(...args);
      }
    },
    GetObjectCommand: class extends Command {},
    PutObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
  };
});

import { uploadImageObject } from "@/lib/r2";

const saved = process.env.R2_DRY_RUN;
const savedUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.send.mockReset().mockResolvedValue({});
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://pub.example";
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (saved === undefined) delete process.env.R2_DRY_RUN;
  else process.env.R2_DRY_RUN = saved;
  if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  else process.env.NEXT_PUBLIC_R2_PUBLIC_URL = savedUrl;
  log.mockRestore();
});

describe("uploadImageObject under R2_DRY_RUN", () => {
  it('"true" skips the write, logs the skip and returns the URL the object would have', async () => {
    process.env.R2_DRY_RUN = "true";
    const url = await uploadImageObject("img-1", Buffer.from("png-bytes"));
    expect(h.send).not.toHaveBeenCalled();
    expect(url).toBe("https://pub.example/images/img-1.png");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[R2_DRY_RUN] Skipping the write of images/img-1.png"));
  });

  it("unset writes the object and returns the same URL", async () => {
    delete process.env.R2_DRY_RUN;
    const url = await uploadImageObject("img-2", Buffer.from("png-bytes"));
    expect(h.send).toHaveBeenCalledTimes(1);
    const [command] = h.send.mock.calls[0] as [{ input: { Key: string; ContentType: string } }];
    expect(command.input.Key).toBe("images/img-2.png");
    expect(command.input.ContentType).toBe("image/png");
    expect(url).toBe("https://pub.example/images/img-2.png");
  });

  it('any other value ("false", "1") writes', async () => {
    for (const value of ["false", "1"]) {
      h.send.mockClear();
      process.env.R2_DRY_RUN = value;
      await uploadImageObject("img-3", Buffer.from("png-bytes"));
      expect(h.send).toHaveBeenCalledTimes(1);
    }
  });
});
