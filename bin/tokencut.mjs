#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { analyzePayload, compact } from "../src/index.mjs";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : def; };
const has = (name) => args.includes(name);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--max" && args[args.indexOf(a) - 1] !== "--max-tool" && args[args.indexOf(a) - 1] !== "--price" && args[args.indexOf(a) - 1] !== "--out");

if (!file || has("--help")) {
  console.log(`tokencut -- measure and cut the token cost of an LLM/agent payload

  tokencut <payload.json>                 analyze where the tokens go
  tokencut <payload.json> --compact       cut the payload, print the savings
    --max <n>        drop oldest messages until under n tokens
    --max-tool <n>   truncate tool results bigger than n tokens (default 500)
    --no-dedupe      keep duplicate context blocks
    --out <file>     write the compacted payload
    --price <n>      $ per 1M input tokens for the cost estimate (default 3)
    --json           machine-readable output

Payload: an array of messages, or { system, messages } (Anthropic or OpenAI style).`);
  process.exit(file ? 0 : 1);
}

const price = Number(flag("--price", 3));
let payload;
try { payload = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.error(`could not read ${file}: ${e.message}`); process.exit(1); }

const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : "" + n);
const usd = (n) => "$" + n.toFixed(n < 0.01 ? 5 : 4);

if (has("--compact")) {
  const res = compact(payload, {
    maxTokens: flag("--max", null) ? Number(flag("--max", null)) : null,
    maxToolResultTokens: Number(flag("--max-tool", 500)),
    dropDuplicates: !has("--no-dedupe"),
  });
  if (flag("--out", null)) { writeFileSync(String(flag("--out", null)), JSON.stringify(res.payload, null, 2)); }
  if (has("--json")) { console.log(JSON.stringify(res.report, null, 2)); process.exit(0); }
  const r = res.report;
  console.log(`\n  tokencut compact`);
  console.log(`  before   ${k(r.beforeTokens)} tokens  (${usd((r.beforeTokens / 1e6) * price)})`);
  console.log(`  after    ${k(r.afterTokens)} tokens  (${usd((r.afterTokens / 1e6) * price)})`);
  console.log(`  saved    ${k(r.savedTokens)} tokens  ${r.savedPct}%  (${usd((r.savedTokens / 1e6) * price)})`);
  const counts = r.actions.reduce((m, a) => { const key = a.split(":").slice(0, 2).join(":"); m[key] = (m[key] || 0) + 1; return m; }, {});
  if (Object.keys(counts).length) console.log(`  actions  ` + Object.entries(counts).map(([a, n]) => `${a} x${n}`).join(", "));
  if (flag("--out", null)) console.log(`  wrote    ${flag("--out", null)}`);
  console.log();
} else {
  const a = analyzePayload(payload, { pricePerMTok: price });
  if (has("--json")) { console.log(JSON.stringify(a, null, 2)); process.exit(0); }
  console.log(`\n  tokencut  ${k(a.totalTokens)} tokens  (~${usd(a.costUSD)} at $${price}/M)  across ${a.units} blocks\n`);
  const row = (label, obj) => {
    console.log(`  ${label}`);
    for (const [k2, v] of Object.entries(obj).sort((x, y) => y[1] - x[1]))
      console.log(`    ${String(k2).padEnd(14)} ${String(k(v)).padStart(7)}  ${"#".repeat(Math.round((v / a.totalTokens) * 24))}`);
  };
  row("by kind", a.byKind);
  console.log();
  row("by role", a.byRole);
  console.log(`\n  biggest blocks`);
  for (const b of a.biggest.slice(0, 6)) console.log(`    ${String(k(b.tokens)).padStart(7)}  ${b.kind.padEnd(12)} ${b.preview}`);
  console.log(`\n  cut it: tokencut ${file} --compact --max 8000\n`);
}
