/**
 * Pipeshift settlement indexer.
 *
 * Decodes settlement and netting events, then aggregates them into positions,
 * per security totals and compression reports. Read only by construction: there
 * is no signer here and nothing in this package can send a transaction.
 */

export * from "./types.js";
export * from "./chain.js";
export * from "./decode.js";
export * from "./fetch.js";
export * from "./aggregate.js";
export * from "./report.js";
