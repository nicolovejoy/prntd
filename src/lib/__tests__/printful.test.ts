import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOrder, createMockupTask, pollMockupTask } from "../printful";

const params = {
  designImageUrl: "https://example.com/img.png",
  size: "M",
  color: "Black",
  variantId: 4012,
  recipientName: "Test User",
  address1: "1 Test St",
  city: "Seattle",
  stateCode: "WA",
  countryCode: "US",
  zip: "98101",
};

describe("createOrder PRINTFUL_DRY_RUN", () => {
  const originalFlag = process.env.PRINTFUL_DRY_RUN;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    process.env.PRINTFUL_DRY_RUN = originalFlag;
    fetchSpy.mockRestore();
  });

  it("does not call fetch when flag is true", async () => {
    process.env.PRINTFUL_DRY_RUN = "true";
    await createOrder(params);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a shape callers expect (id, costs.total, status)", async () => {
    process.env.PRINTFUL_DRY_RUN = "true";
    const result = await createOrder(params);
    expect(result.id).toMatch(/^dry-run-/);
    expect(result.status).toBe("draft");
    expect(result.costs?.total).toBe("0.00");
  });

  it("calls fetch when flag is unset", async () => {
    delete process.env.PRINTFUL_DRY_RUN;
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { id: 1, costs: { total: "5.00" } } }), {
        status: 200,
      })
    );
    await createOrder(params);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("calls fetch when flag is the string 'false'", async () => {
    process.env.PRINTFUL_DRY_RUN = "false";
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { id: 1, costs: { total: "5.00" } } }), {
        status: 200,
      })
    );
    await createOrder(params);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe("createMockupTask", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const position = {
    area_width: 1800,
    area_height: 2400,
    width: 1800,
    height: 1800,
    top: 300,
    left: 0,
  };

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => fetchSpy.mockRestore());

  it("sends variant_ids as an array (multi-variant bulk path)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { task_key: "abc123" } }), {
        status: 200,
      })
    );
    await createMockupTask(71, [4012, 4017, 4022], "https://x/img.png", position, "front");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.variant_ids).toEqual([4012, 4017, 4022]);
    expect(body.format).toBe("jpg");
    expect(body.files[0].placement).toBe("front");
  });

  it("returns the task_key from the response", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ result: { task_key: "task-xyz" } }), {
        status: 200,
      })
    );
    const key = await createMockupTask(71, [4012], "https://x/img.png", position, "front");
    expect(key).toBe("task-xyz");
  });
});

describe("pollMockupTask", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => fetchSpy.mockRestore());

  it("returns one entry per rendered mockup, preserving variantIds grouping", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            status: "completed",
            mockups: [
              { variant_ids: [4012, 4017], mockup_url: "https://printful.com/m1.jpg" },
              { variant_ids: [4022], mockup_url: "https://printful.com/m2.jpg" },
            ],
          },
        }),
        { status: 200 }
      )
    );
    const result = await pollMockupTask("task-xyz");
    expect(result).toEqual([
      { variantIds: [4012, 4017], mockupUrl: "https://printful.com/m1.jpg" },
      { variantIds: [4022], mockupUrl: "https://printful.com/m2.jpg" },
    ]);
  });

  it("throws when the task reports failed", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ result: { status: "failed", error: "bad image" } }),
        { status: 200 }
      )
    );
    await expect(pollMockupTask("task-xyz")).rejects.toThrow(/bad image/);
  });

  it("throws when completed but no mockups", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ result: { status: "completed", mockups: [] } }),
        { status: 200 }
      )
    );
    await expect(pollMockupTask("task-xyz")).rejects.toThrow(/no URLs/);
  });
});
