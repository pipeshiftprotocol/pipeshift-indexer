/**
 * Aggregation over decoded settlement events.
 *
 * Pure functions over arrays: no chain access, no clock, no I/O. That is what
 * makes the numbers this module produces reproducible, and what lets the tests
 * cover the interesting cases without a node.
 */

import type {
  Address,
  CompressionSummary,
  Hex32,
  IndexState,
  Position,
  SecurityStats,
  SettlementEvent,
} from "./types.js";

/** Thrown when events arrive out of order and would corrupt running totals. */
export class OutOfOrderError extends Error {
  readonly previous: bigint;
  readonly current: bigint;

  constructor(previous: bigint, current: bigint) {
    super(`events must be ordered by block: saw ${current} after ${previous}`);
    this.name = "OutOfOrderError";
    this.previous = previous;
    this.current = current;
  }
}

/** Sorts events into chain order: block, then log index. */
export function inChainOrder(events: readonly SettlementEvent[]): SettlementEvent[] {
  return [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });
}

/** Verifies events are already in chain order. */
export function assertOrdered(events: readonly SettlementEvent[]): void {
  let previous = -1n;
  let previousIndex = -1;

  for (const event of events) {
    if (event.blockNumber < previous) throw new OutOfOrderError(previous, event.blockNumber);
    if (event.blockNumber === previous && event.logIndex <= previousIndex) {
      throw new OutOfOrderError(previous, event.blockNumber);
    }
    previous = event.blockNumber;
    previousIndex = event.logIndex;
  }
}

const positionKey = (party: Address, security: Hex32): string =>
  `${party.toLowerCase()}:${security.toLowerCase()}`;

/**
 * Builds net positions per party per security.
 *
 * Only settled instructions carry party level detail. A netting session reports
 * how many legs it moved but not who they belonged to, so sessions contribute to
 * volume and compression but not to positions. Pretending otherwise would invent
 * counterparties that the log does not name.
 */
export function positionsOf(events: readonly SettlementEvent[]): Position[] {
  const positions = new Map<string, Position>();

  const touch = (party: Address, security: Hex32): Position => {
    const key = positionKey(party, security);
    let position = positions.get(key);
    if (!position) {
      position = { party, security, quantity: 0n, cash: 0n, trades: 0 };
      positions.set(key, position);
    }
    return position;
  };

  for (const event of events) {
    if (event.kind !== "settlement") continue;

    const seller = touch(event.seller, event.security);
    seller.quantity -= event.quantity;
    seller.cash += event.consideration;
    seller.trades += 1;

    const buyer = touch(event.buyer, event.security);
    buyer.quantity += event.quantity;
    buyer.cash -= event.consideration;
    buyer.trades += 1;
  }

  return [...positions.values()].sort((a, b) =>
    a.party.toLowerCase() < b.party.toLowerCase() ? -1 : 1,
  );
}

/** Per security totals across the events supplied. */
export function statsOf(events: readonly SettlementEvent[]): SecurityStats[] {
  const stats = new Map<Hex32, SecurityStats>();
  const parties = new Map<Hex32, Set<string>>();

  for (const event of events) {
    let entry = stats.get(event.security);
    if (!entry) {
      entry = {
        security: event.security,
        settlements: 0,
        sessions: 0,
        grossTrades: 0,
        volumeQuantity: 0n,
        volumeConsideration: 0n,
        parties: 0,
        firstBlock: event.blockNumber,
        lastBlock: event.blockNumber,
      };
      stats.set(event.security, entry);
      parties.set(event.security, new Set());
    }

    if (event.blockNumber < entry.firstBlock) entry.firstBlock = event.blockNumber;
    if (event.blockNumber > entry.lastBlock) entry.lastBlock = event.blockNumber;

    if (event.kind === "settlement") {
      entry.settlements += 1;
      entry.grossTrades += 1;
      entry.volumeQuantity += event.quantity;
      entry.volumeConsideration += event.consideration;
      parties.get(event.security)?.add(event.seller.toLowerCase());
      parties.get(event.security)?.add(event.buyer.toLowerCase());
    } else {
      entry.sessions += 1;
      entry.grossTrades += event.grossTrades;
    }
  }

  for (const [security, set] of parties) {
    const entry = stats.get(security);
    if (entry) entry.parties = set.size;
  }

  return [...stats.values()].sort((a, b) => b.grossTrades - a.grossTrades);
}

/**
 * Reports how many transfers netting removed.
 *
 * A settled instruction performs two transfers. A session performs two per leg
 * while representing grossTrades trades, which would have been two transfers each.
 */
export function compressionOf(events: readonly SettlementEvent[]): CompressionSummary {
  let grossSettlements = 0;
  let nettedTrades = 0;
  let transfers = 0;

  for (const event of events) {
    if (event.kind === "settlement") {
      grossSettlements += 1;
      transfers += 2;
    } else {
      nettedTrades += event.grossTrades;
      transfers += event.legs * 2;
    }
  }

  const transfersIfGross = (grossSettlements + nettedTrades) * 2;
  const ratio = transfersIfGross === 0 ? 0 : 1 - transfers / transfersIfGross;

  return { grossSettlements, nettedTrades, transfers, transfersIfGross, ratio };
}
