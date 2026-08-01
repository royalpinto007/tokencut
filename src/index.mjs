// tokencut -- measure and cut the token cost of LLM / agent message payloads.
// Deterministic (no model call), works on Anthropic-style and OpenAI-style messages.

// A fast, honest ESTIMATE of tokens. Real tokenizers vary by model; this blends a
// chars/4 rule with a word count and is typically within ~10-15% of exact BPE counts.
// Swap in a real tokenizer via analyzePayload(payload, { counter }) when you need exact.
export function estimateTokens(text) {
  if (text == null) return 0;
  const s = String(text);
  if (!s) return 0;
  const chars = s.length;
  const words = (s.match(/\S+/g) || []).length;
  return Math.max(Math.ceil(chars / 4), Math.ceil(words * 1.3));
}

// Flatten any supported payload into text units: {role, kind, text}.
// Supported: an array of messages, or { system, messages }.
// Message content may be a string or an array of Anthropic-style blocks.
function blocksOf(content, role) {
  if (content == null) return [];
  if (typeof content === "string") return [{ role, kind: role === "system" ? "system" : "text", text: content }];
  if (Array.isArray(content)) {
    const out = [];
    for (const b of content) {
      if (typeof b === "string") out.push({ role, kind: "text", text: b });
      else if (b && b.type === "text") out.push({ role, kind: "text", text: b.text || "" });
      else if (b && b.type === "tool_use") out.push({ role, kind: "tool_use", text: JSON.stringify(b.input || {}) });
      else if (b && b.type === "tool_result") out.push({ role, kind: "tool_result", text: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "") });
      else out.push({ role, kind: (b && b.type) || "other", text: JSON.stringify(b) });
    }
    return out;
  }
  return [{ role, kind: "other", text: JSON.stringify(content) }];
}

function units(payload) {
  const out = [];
  if (payload && !Array.isArray(payload) && payload.system) out.push(...blocksOf(payload.system, "system"));
  const msgs = Array.isArray(payload) ? payload : (payload && payload.messages) || [];
  for (const m of msgs) out.push(...blocksOf(m.content, m.role || "user"));
  return out;
}

// Report the token breakdown of a payload and where the tokens are going.
export function analyzePayload(payload, { pricePerMTok = 3, counter = estimateTokens, top = 10 } = {}) {
  const us = units(payload).map((u) => ({ ...u, tokens: counter(u.text) }));
  const total = us.reduce((a, u) => a + u.tokens, 0);
  const byKind = {}, byRole = {};
  for (const u of us) {
    byKind[u.kind] = (byKind[u.kind] || 0) + u.tokens;
    byRole[u.role] = (byRole[u.role] || 0) + u.tokens;
  }
  const biggest = [...us].sort((a, b) => b.tokens - a.tokens).slice(0, top)
    .map((u) => ({ role: u.role, kind: u.kind, tokens: u.tokens, preview: u.text.slice(0, 80).replace(/\s+/g, " ") }));
  return { totalTokens: total, costUSD: (total / 1e6) * pricePerMTok, units: us.length, byKind, byRole, biggest };
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function tokensToChars(t) { return Math.max(0, Math.round(t * 4)); }

// Cut a payload's token cost deterministically. Returns { payload, report }.
// Options:
//   maxToolResultTokens  truncate any tool_result bigger than this (default 500)
//   dropDuplicates       remove repeated identical text/tool_result blocks (default true)
//   maxTokens            if set, drop oldest non-system messages until under this budget
//   keepLastTurns        never drop the last N messages when trimming to budget (default 4)
export function compact(payload, opts = {}) {
  const { maxToolResultTokens = 500, dropDuplicates = true, maxTokens = null, keepLastTurns = 4, counter = estimateTokens } = opts;
  const before = analyzePayload(payload, { counter }).totalTokens;
  const out = clone(payload);
  const actions = [];
  const msgs = Array.isArray(out) ? out : out.messages || [];
  const seen = new Set();

  for (const m of msgs) {
    if (!Array.isArray(m.content)) {
      if (typeof m.content === "string" && dropDuplicates) {
        const key = "t:" + m.content;
        if (seen.has(key) && m.content.length > 40) { m.content = "[duplicate of an earlier message, removed by tokencut]"; actions.push("dedupe:message"); }
        else seen.add(key);
      }
      continue;
    }
    const kept = [];
    for (const b of m.content) {
      // truncate oversized tool results
      if (b && b.type === "tool_result") {
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        if (counter(text) > maxToolResultTokens) {
          const cap = tokensToChars(maxToolResultTokens);
          const head = text.slice(0, Math.floor(cap * 0.7));
          const tail = text.slice(-Math.floor(cap * 0.2));
          const removed = counter(text) - counter(head + tail);
          b.content = `${head}\n\n[... tokencut truncated ~${removed} tokens ...]\n\n${tail}`;
          actions.push(`truncate:tool_result:-${removed}`);
        }
      }
      // dedupe identical text / tool_result blocks
      if (dropDuplicates && b && (b.type === "text" || b.type === "tool_result")) {
        const text = b.type === "text" ? b.text || "" : (typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""));
        const key = b.type + ":" + text;
        if (text.length > 40 && seen.has(key)) { actions.push("dedupe:block"); continue; }
        seen.add(key);
      }
      kept.push(b);
    }
    m.content = kept;
  }

  // trim oldest non-system messages to fit a hard budget
  if (maxTokens != null) {
    const isSystem = (m) => (m.role || "") === "system";
    let i = 0;
    while (analyzePayload(out, { counter }).totalTokens > maxTokens) {
      const list = Array.isArray(out) ? out : out.messages;
      const trimmableEnd = list.length - keepLastTurns;
      // find the oldest non-system, trimmable message
      let idx = -1;
      for (let j = 0; j < Math.max(0, trimmableEnd); j++) { if (!isSystem(list[j])) { idx = j; break; } }
      if (idx < 0) break; // nothing left safe to drop
      list.splice(idx, 1);
      actions.push("drop:oldest-message");
      if (++i > 1000) break;
    }
  }

  const after = analyzePayload(out, { counter }).totalTokens;
  return { payload: out, report: { beforeTokens: before, afterTokens: after, savedTokens: before - after, savedPct: before ? Math.round(((before - after) / before) * 100) : 0, actions } };
}
