/**
 * Aggregation over decoded settlement events.
 *
 * Pure functions over arrays: no chain access, no clock, no I/O. That is what
 * makes the numbers this module produces reproducible, and what lets the tests
 * cover the interesting cases without a node.
 */

import type { Address, Hex32, Position, SettlementEvent } from "./types.js";

/** Sorts events into chain order: block, then log index. */
export function inChainOrder(events: readonly SettlementEvent[]): SettlementEvent[] {
  return [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });
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
