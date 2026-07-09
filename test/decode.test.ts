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
