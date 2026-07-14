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
