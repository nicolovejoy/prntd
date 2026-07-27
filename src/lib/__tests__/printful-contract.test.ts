/**
 * Unit coverage for the Printful contract check's request shape and control
 * flow. Deliberately never touches the real Printful API — that is the
 * nightly workflow's job (scripts/printful-contract-check.ts). What's testable
 * here is what the check sends, and that a failed assertion still deletes the
 * order it created.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildContractCheckRequest,
  runPrintfulContractCheck,
  CONTRACT_CHECK_RECIPIENT,
  type ContractCheckClient,
  type PrintfulOrderResponse,
} from "../printful-contract";
import { createOrder } from "../printful";

const ORDER_ID = "854ab0f1-d2e2-44c3-b328-5944fc675c1f";
const FILE_URL = "https://example.com/design.png";

const spec = {
  orderId: ORDER_ID,
  blankId: "bella-canvas-3001",
  color: "Black",
  size: "M",
  frontUrl: FILE_URL,
};

function stubClient(
  overrides: Partial<ContractCheckClient> = {},
  created: Partial<PrintfulOrderResponse> = {}
): ContractCheckClient & { deleteOrder: ReturnType<typeof vi.fn> } {
  const order: PrintfulOrderResponse = {
    id: 987654,
    external_id: "854ab0f1d2e244c3b3285944fc675c1f",
    status: "draft",
    costs: { total: "18.20" },
    ...created,
  };
  return {
    createOrder: vi.fn().mockResolvedValue(order),
    getOrderByExternalId: vi.fn().mockResolvedValue(order),
    deleteOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ContractCheckClient & { deleteOrder: ReturnType<typeof vi.fn> };
}

describe("buildContractCheckRequest", () => {
  it("builds a one-item front+back order against a real catalog variant", () => {
    const req = buildContractCheckRequest(spec);
    expect(req.items).toHaveLength(1);
    expect(req.items[0].quantity).toBe(1);
    expect(typeof req.items[0].variantId).toBe("number");
    expect(req.items[0].files.map((f) => f.placement)).toEqual(["front", "back"]);
  });

  it("defaults the back file to the front file", () => {
    const req = buildContractCheckRequest(spec);
    expect(req.items[0].files[1].url).toBe(FILE_URL);
  });

  it("uses a distinct back file when one is given", () => {
    const req = buildContractCheckRequest({ ...spec, backUrl: "https://example.com/b.png" });
    expect(req.items[0].files[1].url).toBe("https://example.com/b.png");
  });

  it("sends confirm:false — the order must never enter fulfillment", () => {
    expect(buildContractCheckRequest(spec).confirm).toBe(false);
  });

  it("ships the dashed UUID as externalId (createOrder does the 32-char strip)", () => {
    const req = buildContractCheckRequest(spec);
    expect(req.externalId).toBe(ORDER_ID);
    expect(req.externalId.length).toBe(36);
  });

  it("addresses the order to the clearly-marked internal test recipient", () => {
    const req = buildContractCheckRequest(spec);
    expect(req.recipientName).toBe(CONTRACT_CHECK_RECIPIENT.name);
    expect(req.recipientName).toMatch(/DO NOT FULFILL/);
    expect(req.countryCode).toBe("US");
  });

  it("throws on an unknown blank / unfulfillable variant", () => {
    expect(() => buildContractCheckRequest({ ...spec, blankId: "nope" })).toThrow(
      /Unknown product/
    );
    expect(() => buildContractCheckRequest({ ...spec, color: "Chartreuse" })).toThrow(
      /No variant/
    );
  });
});

describe("contract-check request → createOrder wire shape", () => {
  it("produces a body with a 32-char external_id, no confirm param, front+back files", async () => {
    const original = process.env.PRINTFUL_DRY_RUN;
    // Force the real (non-dry-run) branch so we can inspect the wire body.
    delete process.env.PRINTFUL_DRY_RUN;
    // …and prove confirm:false wins even when the env default says confirm.
    const originalAuto = process.env.PRINTFUL_AUTO_CONFIRM;
    delete process.env.PRINTFUL_AUTO_CONFIRM;
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ result: { id: 1, costs: { total: "5.00" } } }), {
          status: 200,
        })
      );
    try {
      await createOrder(buildContractCheckRequest(spec));
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.printful.com/orders");
      expect(url).not.toContain("confirm");
      const body = JSON.parse(String(init.body));
      expect(body.external_id).toHaveLength(32);
      expect(body.external_id).toBe("854ab0f1d2e244c3b3285944fc675c1f");
      expect(body.items[0].files.map((f: { type: string }) => f.type)).toEqual([
        "default",
        "back",
      ]);
    } finally {
      fetchSpy.mockRestore();
      process.env.PRINTFUL_DRY_RUN = original;
      if (originalAuto === undefined) delete process.env.PRINTFUL_AUTO_CONFIRM;
      else process.env.PRINTFUL_AUTO_CONFIRM = originalAuto;
    }
  });
});

describe("runPrintfulContractCheck", () => {
  it("creates, asserts, and deletes the order", async () => {
    const client = stubClient();
    const report = await runPrintfulContractCheck(spec, client);
    expect(report).toMatchObject({
      printfulOrderId: 987654,
      externalId: "854ab0f1d2e244c3b3285944fc675c1f",
      status: "draft",
      costTotal: "18.20",
      deleted: true,
    });
    expect(client.deleteOrder).toHaveBeenCalledWith(987654);
    expect(client.getOrderByExternalId).toHaveBeenCalledWith(ORDER_ID);
  });

  it("deletes the order even when an assertion fails", async () => {
    const client = stubClient({}, { costs: null });
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(/costs\.total/);
    expect(client.deleteOrder).toHaveBeenCalledWith(987654);
  });

  it("fails — and still deletes — when the order comes back not-draft", async () => {
    const client = stubClient({}, { status: "pending" });
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /expected "draft"/
    );
    expect(client.deleteOrder).toHaveBeenCalledWith(987654);
  });

  it("fails when the external_id round trip finds nothing", async () => {
    const client = stubClient({ getOrderByExternalId: vi.fn().mockResolvedValue(null) });
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /returned null/
    );
    expect(client.deleteOrder).toHaveBeenCalled();
  });

  it("fails when the external_id lookup resolves to a different order", async () => {
    const client = stubClient({
      getOrderByExternalId: vi.fn().mockResolvedValue({ id: 111, status: "draft" }),
    });
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /returned order 111/
    );
  });

  it("fails when Printful echoes a different external_id", async () => {
    const client = stubClient({}, { external_id: "truncated" });
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /echoed back/
    );
    expect(client.deleteOrder).toHaveBeenCalled();
  });

  it("surfaces the create error untouched and deletes nothing", async () => {
    const client = stubClient({
      createOrder: vi
        .fn()
        .mockRejectedValue(new Error("Printful API error: 400 Invalid External ID specified")),
    });
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /Invalid External ID/
    );
    expect(client.deleteOrder).not.toHaveBeenCalled();
  });

  it("fails a passing run whose cleanup failed, naming the orphaned order", async () => {
    const client = stubClient({
      deleteOrder: vi.fn().mockRejectedValue(new Error("503")),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /cleanup failed/
    );
    await expect(
      runPrintfulContractCheck(spec, client)
    ).rejects.toThrow(/987654 is still open/);
    errSpy.mockRestore();
  });

  it("keeps the original assertion error when cleanup also fails", async () => {
    const client = stubClient(
      { deleteOrder: vi.fn().mockRejectedValue(new Error("503")) },
      { status: "pending" }
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runPrintfulContractCheck(spec, client)).rejects.toThrow(
      /expected "draft"/
    );
    errSpy.mockRestore();
  });
});
