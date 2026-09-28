/**
 * getObjectByKey with the S3 client mocked: bytes, the shared deadline on
 * the request and the body read (a timeout throws "TimeoutError" and aborts
 * the request), and null for any other failure.
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

import { getObjectByKey, R2_READ_TIMEOUT_MS } from "@/lib/r2";

const never = () => new Promise<never>(() => {});
const errors: string[] = [];
const savedError = console.error;

beforeEach(() => {
  h.send.mockReset();
  errors.length = 0;
  console.error = (msg: string) => errors.push(msg);
});

afterEach(() => {
  console.error = savedError;
  vi.useRealTimers();
});

describe("getObjectByKey", () => {
  it("defaults to a 30 s deadline", () => {
    expect(R2_READ_TIMEOUT_MS).toBe(30_000);
  });

  it("returns the object's bytes and passes an abort signal", async () => {
    h.send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    const bytes = await getObjectByKey("images/a.png");
    expect(bytes).toEqual(Buffer.from([1, 2, 3]));
    const [command, options] = h.send.mock.calls[0];
    expect(command.input).toEqual(expect.objectContaining({ Key: "images/a.png" }));
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
    expect(errors).toEqual([]);
  });

  it("times out a request that never settles, aborting it", async () => {
    vi.useFakeTimers();
    h.send.mockImplementation(never);
    const read = getObjectByKey("images/slow.png", 1000);
    const outcome = read.then(
      () => null,
      (err: unknown) => err
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(h.send.mock.calls[0][1].abortSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("TimeoutError");
    expect(h.send.mock.calls[0][1].abortSignal.aborted).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("images/slow.png");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a body read that never settles", async () => {
    h.send.mockResolvedValue({ Body: { transformToByteArray: never } });
    await expect(getObjectByKey("images/body.png", 20)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(h.send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });

  it("returns null when the request fails, and clears its timer", async () => {
    vi.useFakeTimers();
    h.send.mockRejectedValue(new Error("NoSuchKey"));
    await expect(getObjectByKey("images/gone.png")).resolves.toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("NoSuchKey");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns null when there is no body", async () => {
    h.send.mockResolvedValue({});
    await expect(getObjectByKey("images/empty.png")).resolves.toBeNull();
  });
});
