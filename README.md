# tokencut

**Measure and cut the token cost of your LLM and agent message payloads.** Zero model calls, deterministic, works on Anthropic-style and OpenAI-style messages.

Agents are quietly expensive. Every turn re-sends the whole history, tool results dump thousands of tokens you never read again, and the same context blocks repeat. You pay for all of it, and past a point it causes [context rot](https://research.trychroma.com/context-rot), the model gets *worse* as the window fills. `tokencut` shows you where the tokens go and cuts the waste before you send.

```bash
npx tokencut payload.json                 # where are my tokens going?
npx tokencut payload.json --compact --max 8000   # cut it to fit, see the savings
```

```
  tokencut  42k tokens  (~$0.126 at $3/M)  across 61 blocks

  by kind
    tool_result        36k  ####################
    text                4k  ##
    system             1.4k  #
  ...
  biggest blocks
       12k  tool_result  {"files":[{"path":"...
```

```
  tokencut compact
  before   42k tokens  ($0.126)
  after    9k tokens   ($0.027)
  saved    33k tokens  78%  ($0.099)
  actions  truncate:tool_result x14, dedupe:block x6
```

## What it does

- **Analyze**: breaks a payload down by role and block kind (system, text, tool_use, tool_result) and surfaces the biggest single blocks, with a cost estimate.
- **Compact**: cuts tokens deterministically, no model call, no rewriting of meaning:
  - truncates oversized `tool_result` blocks (keeps head + tail, marks what it dropped),
  - removes duplicate context blocks that repeat verbatim,
  - trims the oldest messages to fit a hard token budget, always keeping `system` and the last N turns.

## Library

```js
import { analyzePayload, compact } from "tokencut";

const report = analyzePayload(messages);            // { totalTokens, costUSD, byKind, byRole, biggest }

const { payload, report: cut } = compact(messages, {
  maxToolResultTokens: 500,   // truncate tool results bigger than this
  dropDuplicates: true,       // remove repeated blocks
  maxTokens: 8000,            // trim oldest messages to fit
  keepLastTurns: 4,           // never drop the most recent turns
});
// cut -> { beforeTokens, afterTokens, savedTokens, savedPct, actions }
```

`payload` is an array of messages, or `{ system, messages }`. Message `content` may be a string or an array of Anthropic-style blocks.

## Accuracy

Token counts are a fast **estimate** (a chars/word blend), typically within ~10-15% of exact BPE counts, enough to find waste and compare before/after. For exact counts, pass your own counter: `analyzePayload(payload, { counter: myTokenizer })`.

## CLI reference

```
tokencut <payload.json>              analyze
tokencut <payload.json> --compact    cut, print savings
  --max <n>        drop oldest messages until under n tokens
  --max-tool <n>   truncate tool results over n tokens (default 500)
  --no-dedupe      keep duplicate blocks
  --out <file>     write the compacted payload
  --price <n>      $ per 1M input tokens for the estimate (default 3)
  --json           machine-readable output
```

## License

[MIT](LICENSE)
