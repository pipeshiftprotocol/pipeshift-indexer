/**
 * Event shapes the indexer works with.
 *
 * Everything downstream of decoding uses these types, so the aggregation layer
 * never touches a raw log and stays testable without a chain.
 */

export type Address = `0x${string}`;
export type Hex32 = `0x${string}`;

/** A settled instruction, one matched trade that moved both legs. */
export interface SettledInstruction {
  kind: "settlement";
  id: Hex32;
  security: Hex32;
  seller: Address;
  buyer: Address;
  quantity: bigint;
  consideration: bigint;
  blockNumber: bigint;
  txHash: Hex32;
  logIndex: number;
}

/** A netting session, many trades collapsed into net positions. */
export interface SettledSession {
  kind: "session";
  session: bigint;
  security: Hex32;
  legs: number;
  grossTrades: number;
  blockNumber: bigint;
  txHash: Hex32;
  logIndex: number;
}

export type SettlementEvent = SettledInstruction | SettledSession;

/** Running position for one party in one security. */
export interface Position {
  party: Address;
  security: Hex32;
  /** Net security units received minus delivered. */
  quantity: bigint;
  /** Net cash received minus paid. */
  cash: bigint;
  /** Instructions this party appeared in. */
  trades: number;
}

/** Per security totals across the indexed range. */
/** How much movement netting removed across the indexed range. */
export interface CompressionSummary {
  /** Trades that settled one by one. */
  grossSettlements: number;
  /** Trades that arrived inside a netting session. */
  nettedTrades: number;
  /** Transfers actually performed. */
  transfers: number;
  /** Transfers gross settlement would have performed. */
  transfersIfGross: number;
  /** Share of transfers removed, between 0 and 1. */
  ratio: number;
}

/** The indexer's view of a block range. */
export interface IndexState {
  fromBlock: bigint;
  toBlock: bigint;
  events: number;
  securities: number;
}
