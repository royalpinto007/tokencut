# Changelog

## [0.1.1] - 2026-08-06

### Changed

- Repository moved to the `AgentPostmortem` GitHub organization; package metadata
  (`repository`, `bugs`, `homepage`) now points at the new location. The package
  name and scope are unchanged.

## [0.1.0] - 2026-08-01

### Added
- `analyzePayload`: token breakdown by role and block kind, biggest blocks, cost estimate.
- `compact`: truncate oversized tool results, drop duplicate blocks, trim oldest messages to a budget.
- `tokencut` CLI: analyze and `--compact` a payload with a savings report.
