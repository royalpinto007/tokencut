import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, analyzePayload, compact } from "../src/index.mjs";

test("estimateTokens is positive and grows with length", () => {
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("a".repeat(400)) > estimateTokens("a".repeat(40)));
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
});

test("analyzePayload totals across roles and kinds", () => {
  const payload = {
    system: "You are a helpful agent.",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }, { type: "tool_use", input: { q: "weather" } }] },
      { role: "user", content: [{ type: "tool_result", content: "x".repeat(2000) }] },
    ],
  };
  const a = analyzePayload(payload);
  assert.ok(a.totalTokens > 0);
  assert.ok(a.byRole.system > 0);
  assert.ok(a.byKind.tool_result > a.byKind.text);
  assert.ok(a.costUSD > 0);
});

test("compact truncates a bloated tool_result and reports savings", () => {
  const payload = { messages: [{ role: "user", content: [{ type: "tool_result", content: "x".repeat(8000) }] }] };
  const { payload: out, report } = compact(payload, { maxToolResultTokens: 100 });
  assert.ok(report.savedTokens > 0);
  assert.ok(report.afterTokens < report.beforeTokens);
  assert.ok(out.messages[0].content[0].content.includes("tokencut truncated"));
});

test("compact dedupes identical blocks", () => {
  const dup = "this is a repeated context block that appears twice in the payload";
  const payload = { messages: [
    { role: "user", content: [{ type: "text", text: dup }] },
    { role: "user", content: [{ type: "text", text: dup }] },
  ] };
  const { report } = compact(payload);
  assert.ok(report.actions.some((a) => a.startsWith("dedupe")));
});

test("compact trims oldest messages to a hard budget, keeps system", () => {
  const messages = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 20; i++) messages.push({ role: "user", content: "message number " + i + " " + "y".repeat(200) });
  const { payload: out, report } = compact({ messages }, { maxTokens: 300, keepLastTurns: 2 });
  assert.ok(report.afterTokens <= 300 || report.savedTokens > 0);
  assert.equal(out.messages[0].role, "system");
});
