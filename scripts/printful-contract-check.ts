/**
 * Printful contract check — one real, UNCONFIRMED order against the live API.
 *
 * Everything else we run submits to Printful in dry-run or against a mock, so
 * real field constraints are never exercised. That is how the 32-char
 * `external_id` cap got to production: `createOrder` sent a 36-char dashed
 * UUID, two paying customers' orders failed submission, and it sat live for
 * two weeks (2026-07-19, fixed by `toPrintfulExternalId`).
 *
 * This creates a representative front+back order through the SAME
 * `createOrder` code path production uses — UUID order id as external_id, a
 * real catalog variant — asserts the response, and deletes the order. The
 * order is never confirmed, so Printful neither charges nor prints it.
 *
 * Never-confirm, in layers (see src/lib/printful-contract.ts):
 *   1. PRINTFUL_AUTO_CONFIRM is hard-set to "false" here, before anything runs.
 *   2. The request carries `confirm: false`, so createOrder omits Printful's
 *      ?confirm=true query param regardless of env.
 *   3. A response in any status but "draft" is a hard failure.
 *   4. The order is deleted in a finally, so a failed assertion still cleans up.
 *
 * Fails loud (exit 1) on a missing/placeholder PRINTFUL_API_KEY — it must not
 * self-skip and report green, or it stops being a check.
 *
 * Run:
 *   PRINTFUL_API_KEY=… npx tsx scripts/printful-contract-check.ts
 *   npx tsx --env-file=.env.local scripts/printful-contract-check.ts
 *
 * Optional args: [blankId] [color] [size]
 * Optional env:  PRINTFUL_CONTRACT_FILE_URL (print file), PRINTFUL_CONTRACT_BACK_FILE_URL
 */

import { randomUUID } from "node:crypto";
import { createOrder, getOrderByExternalId, deleteOrder } from "../src/lib/printful";
import { runPrintfulContractCheck } from "../src/lib/printful-contract";

// Layer 1 of the never-confirm guarantee. `createOrder` reads this at call
// time (not at module load), so setting it here — before any call — is what
// matters; ESM import hoisting doesn't affect it. Belt for the
// `confirm: false` suspenders carried in the request itself.
process.env.PRINTFUL_AUTO_CONFIRM = "false";

const blankId = process.argv[2] ?? "bella-canvas-3001";
const color = process.argv[3] ?? "Black";
const size = process.argv[4] ?? "M";

/**
 * Print file. Printful wants a publicly-fetchable URL; this is a real, stable
 * object in the production R2 bucket that scripts/test-back-mockup.ts and
 * scripts/estimate-back-cost.ts have used against the live API since June.
 * Nothing guarantees it forever — if it 404s, override with
 * PRINTFUL_CONTRACT_FILE_URL rather than loosening the check.
 */
const DEFAULT_FILE_URL =
  "https://pub-7389d029733346daa7c3196cad2f5288.r2.dev/designs/6f5599a3-9736-40a9-903f-892e66de5cf2/1.png";

const frontUrl = process.env.PRINTFUL_CONTRACT_FILE_URL || DEFAULT_FILE_URL;
const backUrl = process.env.PRINTFUL_CONTRACT_BACK_FILE_URL || frontUrl;

function refuse(message: string): never {
  console.error(`Printful contract check refused: ${message}`);
  process.exit(1);
}

// The whole point is the real API. A dry run would assert nothing.
if (process.env.PRINTFUL_DRY_RUN === "true") {
  refuse("PRINTFUL_DRY_RUN=true — this check must hit the real Printful API.");
}

const key = process.env.PRINTFUL_API_KEY ?? "";
// CI sets a placeholder key job-wide for module-eval-time constructors; this
// step must get the real secret instead. Catch the placeholder (and a missing
// secret, which arrives as "") rather than reporting a confusing 401.
if (!key || key === "pf_ci_skip" || key.length < 20) {
  refuse(
    "PRINTFUL_API_KEY is missing or a placeholder. Set the real key (repo secret " +
      "PRINTFUL_API_KEY in CI, .env.local locally). This check never self-skips."
  );
}

async function main() {
  // A real UUID — a dashed one is 36 chars, 4 over Printful's external_id cap.
  // This is the field that broke in production.
  const orderId = randomUUID();

  console.log(
    `Printful contract check — ${blankId} ${color}/${size}, front+back, ` +
      `unconfirmed draft (never charged, never printed)`
  );
  console.log(`  order id: ${orderId}`);
  console.log(`  print file: ${frontUrl}`);

  const report = await runPrintfulContractCheck(
    { orderId, blankId, color, size, frontUrl, backUrl },
    {
      // The production code path, not a hand-rolled fetch.
      createOrder,
      getOrderByExternalId,
      deleteOrder,
    },
    (msg) => console.log(`  ${msg}`)
  );

  console.log(
    `\nPASS — printfulOrderId=${report.printfulOrderId} status=${report.status} ` +
      `costs.total=${report.costTotal} external_id=${report.externalId} ` +
      `(${report.externalId.length} chars) deleted=${report.deleted}`
  );
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
