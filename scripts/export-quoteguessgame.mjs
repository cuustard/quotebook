/**
 * One-off migration: QuoteGuessGame → a Quotebook import file.
 *
 * Reads the QuoteGuessGame Supabase project READ-ONLY and writes a JSON file
 * in Quotebook's own backup format, which the app imports through its normal
 * createQuote() path (so LWW clocks, length caps and validation all come from
 * the same tested code every other quote goes through).
 *
 * Nothing is written to either database by this script.
 *
 *   node scripts/export-quoteguessgame.mjs \
 *     --env ../QuoteGuessGame/.env.local \
 *     --out quoteguessgame-import.json \
 *     --name "QuoteGuessGame archive"
 *
 * Field mapping (see README):
 *   conversations            → quotes
 *     .happened_at           → quote_date + quote_time   (naive local time)
 *     .context               → quote_context             (the situation)
 *   dialogue_lines           → quote_lines
 *     .line_order            → order_index               (1-based → 0-based)
 *     .speaker_id → speakers.name → speaker              (null → "")
 *     .line_text             → line_text
 *     .action_text           → line_context              (how/what they did)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Mirrors src/lib/types.ts — kept literal so this script has no build step.
const MAX_LINE_TEXT = 500;
const MAX_CONTEXT = 1000;
const MAX_QUOTE_CONTEXT = 500;

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const envPath = resolve(HERE, arg("--env", "../../QuoteGuessGame/.env.local"));
const outPath = resolve(HERE, "..", arg("--out", "quoteguessgame-import.json"));
const bookName = arg("--name", "QuoteGuessGame archive");

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error(`No Supabase URL/key found in ${envPath}`);
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/**
 * "2020-10-31T20:43:00" (naive local, no zone) → date + 24h time.
 * Parsed by hand rather than via Date so a machine timezone can't shift the
 * timestamp — these are wall-clock moments, not instants.
 */
function splitHappenedAt(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value ?? "");
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

const speakers = Object.fromEntries(
  (await get("speakers?select=id,name")).map((s) => [s.id, s.name]),
);

// Supabase caps a single response; page so this scales past the current 361.
const conversations = [];
const PAGE = 500;
for (let offset = 0; ; offset += PAGE) {
  const page = await get(
    "conversations?select=id,happened_at,context," +
      "dialogue_lines(id,line_order,speaker_id,action_text,line_text)" +
      `&order=id&offset=${offset}&limit=${PAGE}`,
  );
  conversations.push(...page);
  if (page.length < PAGE) break;
}

const warnings = [];
const quotes = [];

for (const conv of conversations) {
  const when = splitHappenedAt(conv.happened_at);
  if (!when) {
    warnings.push(`conversation #${conv.id}: unreadable happened_at, skipped`);
    continue;
  }

  const lines = (conv.dialogue_lines ?? [])
    .slice()
    .sort((a, b) => a.line_order - b.line_order)
    .map((l, index) => {
      if (l.speaker_id != null && !speakers[l.speaker_id]) {
        warnings.push(`conversation #${conv.id}: unknown speaker_id ${l.speaker_id}`);
      }
      return {
        speaker: (speakers[l.speaker_id] ?? "").slice(0, 120),
        line_text: (l.line_text ?? "").trim().slice(0, MAX_LINE_TEXT),
        line_context: (l.action_text ?? "").trim().slice(0, MAX_CONTEXT),
        // line_order is 1-based upstream; order_index is 0-based here. Use the
        // sorted position rather than the raw value so gaps don't leak through.
        order_index: index,
      };
    })
    .filter((l) => l.line_text.length > 0);

  if (lines.length === 0) {
    warnings.push(`conversation #${conv.id}: no lines with text, skipped`);
    continue;
  }

  quotes.push({
    source_id: conv.id,
    quote_date: when.date,
    quote_time: when.time,
    quote_context: (conv.context ?? "").trim().slice(0, MAX_QUOTE_CONTEXT),
    tags: [],
    lines,
  });
}

const backup = {
  app: "quotebook",
  version: 1,
  exported_at: new Date().toISOString(),
  source: "QuoteGuessGame",
  quotebooks: [{ name: bookName, is_private: false, quotes }],
};

writeFileSync(outPath, JSON.stringify(backup, null, 2));

const lineCount = quotes.reduce((n, q) => n + q.lines.length, 0);
console.log(`Wrote ${outPath}`);
console.log(
  `  ${quotes.length} quotes · ${lineCount} lines · ` +
    `${quotes.filter((q) => q.quote_context).length} with context · ` +
    `${new Set(quotes.flatMap((q) => q.lines.map((l) => l.speaker))).size} speakers`,
);
if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 20)) console.log(`   - ${w}`);
  if (warnings.length > 20) console.log(`   … and ${warnings.length - 20} more`);
}
