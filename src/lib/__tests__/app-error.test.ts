import { describe, it, expect } from "vitest";
import {
  shapeAppError,
  appErrorLogLine,
  MESSAGE_CAP,
  STACK_CAP,
} from "@/lib/app-error";

describe("shapeAppError", () => {
  it("shapes an Error with digest, request, and context", () => {
    const err = Object.assign(new Error("boom"), { digest: "123456789" });
    const shape = shapeAppError(
      err,
      { path: "/designs?x=1", method: "POST" },
      {
        routerKind: "App Router",
        routePath: "/designs",
        routeType: "action",
        renderSource: "react-server-components",
        revalidateReason: undefined,
      }
    );

    expect(shape.digest).toBe("123456789");
    expect(shape.message).toBe("boom");
    expect(shape.stack).toContain("boom");
    expect(shape.path).toBe("/designs?x=1");
    expect(shape.method).toBe("POST");
    expect(shape.context).toEqual({
      routerKind: "App Router",
      routePath: "/designs",
      routeType: "action",
      renderSource: "react-server-components",
    });
  });

  it("truncates long message and stack", () => {
    const err = new Error("m".repeat(MESSAGE_CAP + 100));
    err.stack = "s".repeat(STACK_CAP + 100);
    const shape = shapeAppError(err);

    expect(shape.message).toHaveLength(MESSAGE_CAP);
    expect(shape.stack).toHaveLength(STACK_CAP);
  });

  it("handles non-Error throws", () => {
    expect(shapeAppError("plain string").message).toBe("plain string");
    expect(shapeAppError(42).message).toBe("42");
    expect(shapeAppError({ some: "object" }).message).toBe("[object Object]");
  });

  it("handles null, undefined, and unstringifiable values", () => {
    expect(shapeAppError(null).message).toBe("Unknown error");
    expect(shapeAppError(undefined).message).toBe("Unknown error");

    const hostile = {
      toString() {
        throw new Error("nope");
      },
    };
    expect(shapeAppError(hostile).message).toBe("[unstringifiable]");
  });

  it("ignores non-string digests and empty messages fall back to name", () => {
    const err = Object.assign(new Error(""), { digest: 42 });
    const shape = shapeAppError(err);
    expect(shape.digest).toBeNull();
    expect(shape.message).toBe("Error");
  });

  it("returns nulls when request/context are missing", () => {
    const shape = shapeAppError(new Error("x"));
    expect(shape.path).toBeNull();
    expect(shape.method).toBeNull();
    expect(shape.context).toBeNull();
    expect(shape.digest).toBeNull();
  });

  it("drops non-string request fields", () => {
    const shape = shapeAppError(new Error("x"), {
      path: 7 as unknown as string,
      method: null as unknown as string,
    });
    expect(shape.path).toBeNull();
    expect(shape.method).toBeNull();
  });
});

describe("appErrorLogLine", () => {
  it("emits one parseable JSON line with the event marker", () => {
    const shape = shapeAppError(
      Object.assign(new Error("boom"), { digest: "d1" }),
      { path: "/x", method: "GET" },
      { routerKind: "App Router", routeType: "render" }
    );
    const line = appErrorLogLine(shape, new Date("2026-07-28T00:00:00Z"));

    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      event: "app_error",
      timestamp: "2026-07-28T00:00:00.000Z",
      digest: "d1",
      message: "boom",
      path: "/x",
      method: "GET",
      routerKind: "App Router",
      routeType: "render",
    });
    expect(parsed.stack).toContain("boom");
  });
});
