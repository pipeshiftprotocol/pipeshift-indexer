/**
 * Live log fetching.
 *
 * This is the only module that talks to a node. Everything below it operates on
 * decoded events, which is why the aggregation layer stays testable without a
 * chain and why a bad RPC cannot corrupt a report: it can only fail to produce one.
 */

import { type PublicClient } from "viem";
import { settlementAbi, type Enricher, type InstructionDetail, type RawLog } from "./decode.js";
import { decodeLogs } from "./decode.js";
import type { Deployment } from "./chain.js";
import type { Hex32, SettlementEvent } from "./types.js";

/** ABI fragment for reading a stored instruction back. */
const instructionAbi = [
  {
    type: "function",
    name: "instructionOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "security", type: "bytes32" },
          { name: "cash", type: "address" },
          { name: "seller", type: "address" },
          { name: "buyer", type: "address" },
          { name: "quantity", type: "uint256" },
          { name: "consideration", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "venue", type: "address" },
        ],
      },
      { type: "uint8" },
    ],
  },
] as const;

export interface FetchOptions {
  client: PublicClient;
  deployment: Deployment;
  fromBlock: bigint;
  /** Defaults to the current head. */
  toBlock?: bigint;
  /** Blocks per request. Providers cap this, commonly at 10k. */
  chunkSize?: bigint;
  /** Called after each chunk, for progress reporting. */
  onProgress?: (from: bigint, to: bigint, found: number) => void;
}

/** Thrown when a provider rejects a range even at the minimum chunk size. */
export class RangeTooWideError extends Error {
  constructor(
    readonly from: bigint,
    readonly to: bigint,
    readonly cause_: unknown,
  ) {
    super(`provider rejected blocks ${from}..${to} at the smallest chunk size`);
    this.name = "RangeTooWideError";
  }
}

/**
 * Splits a block range into chunks a provider will accept.
 *
 * Ranges are inclusive on both ends, so a single block range is from == to.
 */
export function chunkRange(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (size <= 0n) throw new RangeError("chunk size must be positive");
  if (to < from) return [];

  const chunks: Array<[bigint, bigint]> = [];
  let cursor = from;

  while (cursor <= to) {
    const end = cursor + size - 1n;
    chunks.push([cursor, end > to ? to : end]);
    cursor = end + 1n;
  }

  return chunks;
}

/**
 * Builds an enricher that reads amounts from the settlement engine.
 *
 * `InstructionSettled` indexes the parties but not the amounts, so the amounts have
 * to come from a read. Results are cached per id because a batch of logs frequently
 * references the same instruction more than once.
 */
export function engineEnricher(
  client: PublicClient,
  deployment: Deployment,
): { enricher: Enricher; prime: (ids: readonly Hex32[]) => Promise<void> } {
  const cache = new Map<Hex32, InstructionDetail>();

  const prime = async (ids: readonly Hex32[]): Promise<void> => {
    const missing = [...new Set(ids)].filter((id) => !cache.has(id));

    const reads = await Promise.all(
      missing.map(async (id) => {
        try {
          const [instruction] = await client.readContract({
            address: deployment.settlementEngine,
            abi: instructionAbi,
            functionName: "instructionOf",
            args: [id],
          });
          return [id, instruction] as const;
        } catch {
          return [id, undefined] as const;
        }
      }),
    );

    for (const [id, instruction] of reads) {
      if (!instruction) continue;
      cache.set(id, {
        security: instruction.security,
        quantity: instruction.quantity,
        consideration: instruction.consideration,
      });
    }
  };

  return { enricher: (id) => cache.get(id), prime };
}

/**
 * Fetches and decodes every settlement event in a block range.
 *
 * Chunks are halved and retried when a provider rejects the range, which is the
 * common failure with public endpoints and their undocumented limits.
 */
export async function fetchEvents(options: FetchOptions): Promise<SettlementEvent[]> {
  const { client, deployment, fromBlock, onProgress } = options;
  const chunkSize = options.chunkSize ?? 5_000n;

  // Clamp to the head rather than asking for blocks that do not exist yet. A
  // provider rejects a future range outright, which would otherwise surface as a
  // RangeTooWideError and hide the real cause from the caller.
  const head = await client.getBlockNumber();
  if (fromBlock > head) return [];

  const requested = options.toBlock ?? head;
  const toBlock = requested > head ? head : requested;

  const { enricher, prime } = engineEnricher(client, deployment);
  const events: SettlementEvent[] = [];

  for (const [start, end] of chunkRange(fromBlock, toBlock, chunkSize)) {
    const logs = await getLogsAdaptive(client, deployment, start, end, chunkSize);

    const ids = logs
      .map((log) => log.topics[1])
      .filter((topic): topic is Hex32 => typeof topic === "string");
    await prime(ids);

    const decoded = decodeLogs(logs, enricher);
    events.push(...decoded);
    onProgress?.(start, end, decoded.length);
  }

  return events;
}

/** Requests logs, halving the range on rejection until it is a single block. */
async function getLogsAdaptive(
  client: PublicClient,
  deployment: Deployment,
  from: bigint,
  to: bigint,
  size: bigint,
): Promise<RawLog[]> {
  try {
    const logs = await client.getLogs({
      address: [deployment.settlementEngine, deployment.nettingEngine],
      events: settlementAbi,
      fromBlock: from,
      toBlock: to,
    });

    return logs.map((log) => ({
      address: log.address,
      topics: log.topics as RawLog["topics"],
      data: log.data,
      blockNumber: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? ("0x" as Hex32),
      logIndex: log.logIndex ?? 0,
    }));
  } catch (error) {
    if (from === to) throw new RangeTooWideError(from, to, error);

    const half = size / 2n > 0n ? size / 2n : 1n;
    const out: RawLog[] = [];
    for (const [start, end] of chunkRange(from, to, half)) {
      out.push(...(await getLogsAdaptive(client, deployment, start, end, half)));
    }
    return out;
  }
}
