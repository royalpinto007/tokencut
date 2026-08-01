# Contributing

Bug reports, fixes, and new reducers are welcome.

1. `node --test` should pass.
2. Keep it zero-dependency and deterministic (no model calls in the core).
3. New compaction strategies go in `src/index.mjs` behind a clear option, with a test.

One honest sentence per change in the PR. New to open source? A small fix is a great first PR.
