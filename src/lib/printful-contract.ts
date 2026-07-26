/**
 * Printful contract check — the request-shape builder + runner behind
 * `scripts/printful-contract-check.ts`.
 *
 * Why it exists: every test we have submits to Printful in dry-run or against
 * a mock, so real API field constraints are invisible. The 32-char
 * `external_id` cap (2026-07-19) charged two customers and sat live for two
 * weeks because nothing ever sent a real request. This creates ONE real but
 * UNCONFIRMED order (a draft — no charge, no print), asserts the response, and
 * deletes it.
 *
 * Never-confirm guarantees, in layers:
 *   1. `buildContractCheckRequest` sets `confirm: false`, which makes
 *      `createOrder` omit Printful's `?confirm=true` query param outright.
 *   2. The CLI wrapper hard-sets `PRINTFUL_AUTO_CONFIRM=false` before calling,
 *      so even if (1) regressed the env default couldn't confirm it.
 *   3. `runPrintfulContractCheck` fails if the created order comes back in any
 *      status other than `draft` — a confirmed order is a loud failure, not a
 *      silent one.
 *   4. The order is deleted whether the assertions pass or throw.
 *
 * The client is injected so the control flow (assertions, cleanup-on-failure)
 * is unit-testable without touching the real API.
 */
// Relative imports (not the `@/` alias) so `scripts/printful-contract-check.ts`
// can pull this in under tsx without depending on path-alias resolution — same
// reason printful.ts imports ./blanks relatively.
import { getBlankOrThrow, getVariantId, productSupportsPlacement } from "./blanks";
import { toPrintfulExternalId } from "./printful";

/**
 * Recipient for the draft. Deliberately labeled so anyone looking at the
 * Printful dashboard knows what it is. The address is Printful's own Charlotte
 * facility (already used by scripts/estimate-back-cost.ts for live calls) — a
 * real, deliverable US address, so address validation can't be the reason a
 * run fails, and nothing ships there anyway because the order is never
 * confirmed.
 */
export const CONTRACT_CHECK_RECIPIENT = {
  name: "PRNTD CI contract check DO NOT FULFILL",
  address1: "11025 Westlake Dr",
  city: "Charlotte",
  stateCode: "NC",
  countryCode: "US",
  zip: "28273",
} as const;

export type ContractCheckSpec = {
  /** A UUID, exactly like a real `order.id` — this is what exercises the cap. */
  orderId: string;
  blankId: string;
  color: string;
  size: string;
  /** Publicly-fetchable print file for the front placement. */
  frontUrl: string;
  /** Print file for the back placement. Defaults to the front file. */
  backUrl?: string;
};

export type ContractCheckRequest = {
  items: { variantId: number; quantity: number; files: { placement: string; url: string }[] }[];
  externalId: string;
  confirm: false;
  recipientName: string;
  address1: string;
  city: string;
  stateCode: string;
  countryCode: string;
  zip: string;
};

/**
 * Build the createOrder params for a representative two-placement order —
 * the same shape `submitOrderFulfillment` sends for a front+back purchase
 * (one item, front file typed `default`, back file typed `back`, our order id
 * as external_id), minus the DB.
 */
export function buildContractCheckRequest(spec: ContractCheckSpec): ContractCheckRequest {
  const blank = getBlankOrThrow(spec.blankId);
  const variantId = getVariantId(blank, spec.color, spec.size);
  if (!variantId) {
    throw new Error(
      `No variant for ${spec.color}/${spec.size} on ${spec.blankId}`
    );
  }
  if (!productSupportsPlacement(blank, "back")) {
    throw new Error(`Blank ${spec.blankId} has no "back" placement`);
  }

  return {
    items: [
      {
        variantId,
        quantity: 1,
        files: [
          { placement: "front", url: spec.frontUrl },
          { placement: "back", url: spec.backUrl ?? spec.frontUrl },
        ],
      },
    ],
    externalId: spec.orderId,
    // Never confirm. See the module comment.
    confirm: false,
    recipientName: CONTRACT_CHECK_RECIPIENT.name,
    address1: CONTRACT_CHECK_RECIPIENT.address1,
    city: CONTRACT_CHECK_RECIPIENT.city,
    stateCode: CONTRACT_CHECK_RECIPIENT.stateCode,
    countryCode: CONTRACT_CHECK_RECIPIENT.countryCode,
    zip: CONTRACT_CHECK_RECIPIENT.zip,
  };
}

/** The bits of a Printful order response the check asserts on. */
export type PrintfulOrderResponse = {
  id: string | number;
  external_id?: string | null;
  status?: string | null;
  costs?: { total?: string | number | null } | null;
};

export type ContractCheckClient = {
  createOrder: (params: ContractCheckRequest) => Promise<PrintfulOrderResponse>;
  getOrderByExternalId: (externalId: string) => Promise<PrintfulOrderResponse | null>;
  deleteOrder: (orderId: string | number) => Promise<void>;
};

export type ContractCheckReport = {
  printfulOrderId: string | number;
  externalId: string;
  status: string;
  costTotal: string;
  deleted: boolean;
};

const DRAFT_STATUS = "draft";

function fail(message: string): never {
  throw new Error(`Printful contract check: ${message}`);
}

/**
 * Create the unconfirmed order, assert the response contract, delete it.
 *
 * Assertion failures do NOT skip cleanup — the delete runs in a `finally`.
 * A cleanup failure on an otherwise-passing run is itself a failure (an
 * orphaned draft in the Printful account is something a human has to remove).
 */
export async function runPrintfulContractCheck(
  spec: ContractCheckSpec,
  client: ContractCheckClient,
  log: (msg: string) => void = () => {}
): Promise<ContractCheckReport> {
  const request = buildContractCheckRequest(spec);
  const expectedExternalId = toPrintfulExternalId(spec.orderId);

  log(
    `Creating UNCONFIRMED order: variant=${request.items[0].variantId} ` +
      `placements=${request.items[0].files.map((f) => f.placement).join("+")} ` +
      `external_id=${expectedExternalId} (${expectedExternalId.length} chars)`
  );

  // Outside the try: if creation itself fails there is nothing to clean up,
  // and the raw Printful error (which is the whole point of this check) should
  // surface unwrapped.
  const created = await client.createOrder(request);

  const cleanup: { deleted: boolean; error?: string } = { deleted: false };
  let report: ContractCheckReport;
  try {
    if (created.id == null || created.id === "") {
      fail("created order has no id");
    }
    log(`Created Printful order id=${created.id} status=${created.status}`);

    // Layer 3 of the never-confirm guarantee: anything but a draft means the
    // order entered fulfillment. Fail loudly — the finally block still deletes.
    if (created.status !== DRAFT_STATUS) {
      fail(
        `order ${created.id} came back status="${created.status}", expected "${DRAFT_STATUS}" — ` +
          `it may be confirmed. Check the Printful dashboard immediately.`
      );
    }

    if (created.external_id != null && created.external_id !== expectedExternalId) {
      fail(
        `external_id echoed back as "${created.external_id}", sent "${expectedExternalId}"`
      );
    }

    const total = created.costs?.total;
    if (total == null || total === "") {
      fail(`order ${created.id} has no costs.total (fulfillment books this as COGS)`);
    }

    // The round trip production depends on for stranded-submission recovery
    // (#37/WP1): our UUID, dash-stripped, must actually find the order again.
    const fetched = await client.getOrderByExternalId(spec.orderId);
    if (!fetched) {
      fail(
        `getOrderByExternalId("${expectedExternalId}") returned null — the recovery probe ` +
          `used by the Stripe webhook and the retry cron would not find this order`
      );
    }
    if (String(fetched.id) !== String(created.id)) {
      fail(
        `getOrderByExternalId returned order ${fetched.id}, expected ${created.id}`
      );
    }

    report = {
      printfulOrderId: created.id,
      externalId: expectedExternalId,
      status: String(created.status),
      costTotal: String(total),
      deleted: false,
    };
  } finally {
    try {
      await client.deleteOrder(created.id);
      cleanup.deleted = true;
      log(`Deleted Printful order id=${created.id}`);
    } catch (err) {
      cleanup.error = err instanceof Error ? err.message : String(err);
      console.error(
        `Printful contract check: FAILED TO DELETE order ${created.id} — delete it by hand ` +
          `in the Printful dashboard. Cause: ${cleanup.error}`
      );
    }
  }

  if (!cleanup.deleted) {
    fail(
      `assertions passed but cleanup failed — order ${created.id} is still open in Printful. ` +
        `Delete it by hand. Cause: ${cleanup.error}`
    );
  }

  return { ...report, deleted: true };
}
