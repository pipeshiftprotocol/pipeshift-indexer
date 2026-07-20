import assert from "node:assert/strict";
import { test } from "node:test";

import { positionsOf } from "../dist/aggregate.js";
import { positionTable, positionsCsv, summary } from "../dist/report.js";
import type { Address, Hex32, SettlementEvent } from "../dist/types.js";

const AAPL = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex32;
const deskA = "0x000000000000000000000000000000000000000a" as Address;
const deskB = "0x000000000000000000000000000000000000000b" as Address;

const events: SettlementEvent[] = [
  {
    kind: "settlement",
    id: AAPL,
    security: AAPL,
    seller: deskA,
    buyer: deskB,
    quantity: 400n,
    consideration: 82_000n,
    blockNumber: 1_000n,
    txHash: AAPL,
    logIndex: 0,
  },
  {
    kind: "session",
    session: 1n,
    security: AAPL,
    legs: 6,
    grossTrades: 12_000,
    blockNumber: 1_010n,
    txHash: AAPL,
    logIndex: 1,
  },
];

test("summary reports the range and the compression", () => {
  const text = summary(events);

  assert.match(text, /blocks {10}1000 \.\. 1010/);
  assert.match(text, /settlements {5}1/);
  assert.match(text, /netted trades {3}12000/);
  assert.match(text, /compression {5}99\.9\d%/);
});

test("summary of an empty range still renders", () => {
  const text = summary([]);
  assert.match(text, /events {10}0/);
  assert.ok(!text.includes("security        trades"), "no table without data");
});

test("positionTable ranks by absolute quantity", () => {
  const text = positionTable(events);
  const lines = text.split("\n");

  assert.match(lines[0]!, /party/);
  assert.equal(lines.length, 3, "header plus two parties");
});
