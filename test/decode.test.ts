import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";

import { decodeLog, decodeLogs, settlementAbi } from "../dist/decode.js";
import type { RawLog } from "../dist/decode.js";
import type { Address, Hex32 } from "../dist/types.js";

const AAPL = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex32;
const ID = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex32;
const ENGINE = "0x4444444444444444444444444444444444444444" as Address;
const seller = "0x000000000000000000000000000000000000000a" as Address;
const buyer = "0x000000000000000000000000000000000000000b" as Address;

function settlementLog(): RawLog {
  const topics = encodeEventTopics({
    abi: settlementAbi,
    eventName: "InstructionSettled",
    args: { id: ID, seller, buyer },
  });

  return {
    address: ENGINE,
    topics: topics as RawLog["topics"],
    data: "0x",
    blockNumber: 1_234n,
    transactionHash: ID,
    logIndex: 2,
  };
}

function sessionLog(legs: bigint, grossTrades: bigint): RawLog {
  const topics = encodeEventTopics({
    abi: settlementAbi,
    eventName: "SessionSettled",
    args: { session: 7n, security: AAPL },
  });

  return {
    address: ENGINE,
    topics: topics as RawLog["topics"],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [legs, grossTrades],
    ),
    blockNumber: 1_240n,
    transactionHash: ID,
    logIndex: 0,
  };
}

test("a settlement log decodes when amounts are supplied", () => {
  const event = decodeLog(settlementLog(), () => ({
    security: AAPL,
    quantity: 400n,
    consideration: 82_000n,
  }));

  assert.equal(event?.kind, "settlement");
  assert.equal(event?.security, AAPL);
  assert.equal(event?.blockNumber, 1_234n);
  if (event?.kind === "settlement") {
    assert.equal(event.seller.toLowerCase(), seller);
    assert.equal(event.quantity, 400n);
  }
});

test("a settlement log is skipped when amounts are unavailable", () => {
  assert.equal(decodeLog(settlementLog()), undefined, "no enricher, no event");
  assert.equal(decodeLog(settlementLog(), () => undefined), undefined, "unknown instruction");
});

test("a session log decodes without an enricher", () => {
  const event = decodeLog(sessionLog(6n, 12_000n));

  assert.equal(event?.kind, "session");
  if (event?.kind === "session") {
    assert.equal(event.legs, 6);
    assert.equal(event.grossTrades, 12_000);
    assert.equal(event.session, 7n);
  }
});

test("an unrelated log is ignored rather than guessed at", () => {
  const foreign: RawLog = {
    address: ENGINE,
    topics: ["0x" + "ab".repeat(32) as Hex32],
    data: "0x",
    blockNumber: 1n,
    transactionHash: ID,
    logIndex: 0,
  };

  assert.equal(decodeLog(foreign), undefined);
});

test("decodeLogs keeps only what it understands", () => {
  const foreign: RawLog = {
    address: ENGINE,
    topics: ["0x" + "cd".repeat(32) as Hex32],
    data: "0x",
    blockNumber: 1n,
    transactionHash: ID,
    logIndex: 9,
  };

  const events = decodeLogs([sessionLog(2n, 40n), foreign], () => undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "session");
});

test("a malformed session payload is dropped", () => {
  const broken = { ...sessionLog(1n, 1n), data: "0xdeadbeef" as Hex32 };
  assert.equal(decodeLog(broken), undefined);
});
