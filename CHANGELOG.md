# Changelog

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
