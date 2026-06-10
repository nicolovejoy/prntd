/**
 * Rewrite assistant chat_message rows that were stored with a raw JSON
 * envelope embedded (the prose + {"message": ...} doubling seen on /design,
 * 2026-06-09). The fixed parser stops new pollution; this cleans what's
 * already persisted, since the chat panel renders stored content verbatim.
 *
 * Idempotent — rows whose content has no parseable envelope are untouched.
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/clean-chat-envelopes.ts          # report only
 *   npx tsx scripts/clean-chat-envelopes.ts --apply  # rewrite rows
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { extractChatEnvelope } from "../src/lib/ai";

const apply = process.argv.includes("--apply");

(async () => {
  const c = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  console.log(`DB: ${process.env.DATABASE_URL}\nmode: ${apply ? "APPLY" : "dry run"}\n`);

  const res = await c.execute(
    `SELECT id, content FROM chat_message
     WHERE role = 'assistant' AND content LIKE '%"message"%'`
  );

  let fixed = 0;
  for (const row of res.rows) {
    const id = row.id as string;
    const content = row.content as string;
    const envelope = extractChatEnvelope(content);
    // Only rewrite when there's prose around the envelope (the doubling bug)
    // or the row is a bare stored envelope; skip rows already clean.
    if (!envelope || envelope.message === content) continue;
    fixed++;
    console.log(`${id}: ${content.length} chars → ${envelope.message.length}`);
    if (apply) {
      await c.execute({
        sql: "UPDATE chat_message SET content = ? WHERE id = ?",
        args: [envelope.message, id],
      });
    }
  }
  console.log(`\n${fixed} row(s) ${apply ? "rewritten" : "would be rewritten"} of ${res.rows.length} candidates`);
})();
