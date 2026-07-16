import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OutOfOrderError,
  assertOrdered,
  compressionOf,
  extremes,
  flatParties,
  inChainOrder,
  positionsOf,
  stateOf,
  statsOf,
} from "../dist/aggregate.js";
import type { Address, Hex32, SettlementEvent } from "../dist/types.js";

const AAPL = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex32;
const TSLA = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex32;

const deskA = "0x000000000000000000000000000000000000000a" as Address;
const deskB = "0x000000000000000000000000000000000000000b" as Address;
const deskC = "0x000000000000000000000000000000000000000c" as Address;

let seq = 0;

function settlement(
  seller: Address,
  buyer: Address,
  quantity: bigint,
  consideration: bigint,
  block = 1_000n,
  security: Hex32 = AAPL,
): SettlementEvent {
  seq += 1;
  return {
    kind: "settlement",
    id: `0x${seq.toString(16).padStart(64, "0")}` as Hex32,
    security,
    seller,
    buyer,
    quantity,
    consideration,
    blockNumber: block,
    txHash: `0x${seq.toString(16).padStart(64, "f")}` as Hex32,
    logIndex: seq,
  };
}

function session(
  legs: number,
  grossTrades: number,
  block = 1_100n,
  security: Hex32 = AAPL,
): SettlementEvent {
  seq += 1;
  return {
    kind: "session",
    session: BigInt(seq),
    security,
    legs,
    grossTrades,
    blockNumber: block,
    txHash: `0x${seq.toString(16).padStart(64, "e")}` as Hex32,
    logIndex: seq,
  };
}

test("positions net out offsetting trades", () => {
  const events = [
    settlement(deskA, deskB, 400n, 82_000n),
    settlement(deskB, deskA, 380n, 78_090n),
  ];

  const byParty = new Map(positionsOf(events).map((p) => [p.party, p]));

  assert.equal(byParty.get(deskA)?.quantity, -20n);
  assert.equal(byParty.get(deskB)?.quantity, 20n);
  assert.equal(byParty.get(deskA)?.cash, 3_910n);
  assert.equal(byParty.get(deskB)?.cash, -3_910n);
  assert.equal(byParty.get(deskA)?.trades, 2);
});

test("positions are kept separate per security", () => {
  const events = [
    settlement(deskA, deskB, 100n, 20_000n, 1_000n, AAPL),
    settlement(deskA, deskB, 50n, 15_000n, 1_001n, TSLA),
  ];

  const positions = positionsOf(events);
  assert.equal(positions.length, 4, "two parties in two securities");
  assert.ok(positions.every((p) => p.trades === 1));
});

test("sessions do not invent counterparties", () => {
  const events = [session(6, 12_000)];
  assert.deepEqual(positionsOf(events), [], "a session names no parties");
});

test("stats count netted trades individually", () => {
  const events = [settlement(deskA, deskB, 10n, 100n), session(4, 900)];
  const [stats] = statsOf(events);

  assert.equal(stats?.settlements, 1);
  assert.equal(stats?.sessions, 1);
  assert.equal(stats?.grossTrades, 901, "one settled plus 900 netted");
  assert.equal(stats?.parties, 2, "only settlements name parties");
});

test("stats track the block range per security", () => {
  const events = [
    settlement(deskA, deskB, 1n, 1n, 900n),
    settlement(deskB, deskC, 1n, 1n, 1_500n),
  ];
  const [stats] = statsOf(events);

  assert.equal(stats?.firstBlock, 900n);
  assert.equal(stats?.lastBlock, 1_500n);
  assert.equal(stats?.parties, 3);
});

test("stats rank securities by gross trades", () => {
  const events = [
    settlement(deskA, deskB, 1n, 1n, 1_000n, AAPL),
    session(2, 500, 1_001n, TSLA),
  ];

  const ranked = statsOf(events);
  assert.equal(ranked[0]?.security, TSLA, "500 netted trades outrank one settlement");
});

test("compression compares transfers against settling gross", () => {
  const events = [settlement(deskA, deskB, 1n, 1n), session(6, 12_000)];
  const report = compressionOf(events);

  assert.equal(report.grossSettlements, 1);
  assert.equal(report.nettedTrades, 12_000);
  assert.equal(report.transfers, 14, "two for the settlement, twelve for six legs");
  assert.equal(report.transfersIfGross, 24_002);
  assert.ok(report.ratio > 0.999);
});

test("compression is zero without netting", () => {
  const report = compressionOf([settlement(deskA, deskB, 1n, 1n)]);
  assert.equal(report.ratio, 0, "gross settlement removes nothing");
});

test("compression of an empty range does not divide by zero", () => {
  const report = compressionOf([]);
  assert.equal(report.ratio, 0);
  assert.equal(report.transfers, 0);
});

test("inChainOrder sorts by block then log index", () => {
  const later = settlement(deskA, deskB, 1n, 1n, 2_000n);
  const earlier = settlement(deskB, deskA, 1n, 1n, 1_000n);

  const ordered = inChainOrder([later, earlier]);
  assert.equal(ordered[0]?.blockNumber, 1_000n);
  assert.equal(ordered[1]?.blockNumber, 2_000n);
});

test("assertOrdered rejects a block going backwards", () => {
  const first = settlement(deskA, deskB, 1n, 1n, 2_000n);
  const second = settlement(deskB, deskA, 1n, 1n, 1_000n);

  assert.throws(() => assertOrdered([first, second]), OutOfOrderError);
});
