/**
 * Log decoding.
 *
 * Turns raw logs from the settlement and netting engines into the typed events
 * the rest of the indexer understands. Anything that does not match a known event
 * signature is skipped rather than guessed at.
 */

import { decodeEventLog, parseAbi } from "viem";
import type { Address, Hex32, SettlementEvent } from "./types.js";

/** The two events this indexer cares about. */
export const settlementAbi = parseAbi([
  "event InstructionSettled(bytes32 indexed id, address indexed seller, address indexed buyer)",
  "event SessionSettled(uint256 indexed session, bytes32 indexed security, uint256 legs, uint256 grossTrades)",
]);

/** A raw log as returned by an RPC provider. */
export interface RawLog {
  address: Address;
  topics: [signature: Hex32, ...args: Hex32[]];
  data: Hex32;
  blockNumber: bigint;
  transactionHash: Hex32;
  logIndex: number;
}

/**
 * Extra fields the settlement event does not carry on chain.
 *
 * InstructionSettled indexes the parties but not the amounts, because amounts live
 * in the stored instruction. A caller that wants amounts has to supply them from a
 * read of instructionOf, which the enrich argument is for.
 */
export interface InstructionDetail {
  security: Hex32;
  quantity: bigint;
  consideration: bigint;
}

export type Enricher = (id: Hex32) => InstructionDetail | undefined;

/** Decodes one log, or returns undefined when it is not ours. */
export function decodeLog(log: RawLog, enrich?: Enricher): SettlementEvent | undefined {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: settlementAbi, topics: log.topics, data: log.data });
  } catch {
    return undefined;
  }

  if (decoded.eventName === "InstructionSettled") {
    const { id, seller, buyer } = decoded.args as {
      id: Hex32;
      seller: Address;
      buyer: Address;
    };
    const detail = enrich?.(id);
    if (!detail) return undefined;

    return {
      kind: "settlement",
      id,
      security: detail.security,
      seller,
      buyer,
      quantity: detail.quantity,
      consideration: detail.consideration,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  }

  if (decoded.eventName === "SessionSettled") {
    const { session, security, legs, grossTrades } = decoded.args as {
      session: bigint;
      security: Hex32;
      legs: bigint;
      grossTrades: bigint;
    };

    return {
      kind: "session",
      session,
      security,
      legs: Number(legs),
      grossTrades: Number(grossTrades),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  }

  return undefined;
}

/** Decodes a batch, dropping anything unrecognised. */
export function decodeLogs(logs: readonly RawLog[], enrich?: Enricher): SettlementEvent[] {
  const out: SettlementEvent[] = [];

  for (const log of logs) {
    const event = decodeLog(log, enrich);
    if (event) out.push(event);
  }

  return out;
}
