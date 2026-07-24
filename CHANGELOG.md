# Changelog

## [0.2.0] - 2026-07-29

### Added
- `statsOf` per security totals with block ranges and distinct party counts.
- `extremes` and `flatParties` for finding the largest net exposures and the desks that ended square.
- `positionsCsv` for machine consumption.
- CLI `csv` and `check` commands.

### Changed
- Positions are keyed by party and security, so one desk trading two names no longer collapses
  into a single row.
- Column widths in `positionTable` no longer run together on large quantities.

## [0.1.0] - 2026-07-14

### Added
- Log decoding for `InstructionSettled` and `SessionSettled`, skipping anything unrecognised.
- `positionsOf` net positions from settled instructions.
- `compressionOf` transfers performed against transfers gross settlement would have needed.
- `assertOrdered` and `inChainOrder` for range integrity.
- CLI with `summary` and `positions`.

### Notes
- Netting sessions contribute to volume and compression but never to positions, because
  `SessionSettled` does not name the parties behind its legs.
