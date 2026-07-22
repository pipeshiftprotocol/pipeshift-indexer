#!/usr/bin/env node
/**
 * Pipeshift indexer command line.
 *
 * Reads a JSON file of already decoded events and prints reports. Keeping the
 * chain access outside the CLI means the reports are reproducible from a file and
 * reviewable in a pull request.
 */

import { readFileSync } from "node:fs";
import { inChainOrder } from "./aggregate.js";
import { positionTable, summary } from "./report.js";
import type { SettlementEvent } from "./types.js";

const USAGE = `pipeshift-index <command> <events.json> [options]

Commands
  summary <file>            Totals, compression and per security lines
  positions <file> [id]     Net positions, optionally for one security
  help                      Show this message

Event file
  [{ "kind": "settlement", "id": "0x..", "security": "0x..", "seller": "0x..",
     "buyer": "0x..", "quantity": "400", "consideration": "82000",
     "blockNumber": "1200", "txHash": "0x..", "logIndex": 0 }]

Amounts and block numbers are decimal strings, parsed as bigint.
`;

function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    throw new TypeError(`${field} must be a string, not a number, to avoid precision loss`);
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new TypeError(`${field} must be a decimal string`);
  }
  return BigInt(value);
}

/** Parses the event file, rejecting anything that is not a known event kind. */
export function parseEvents(raw: string): SettlementEvent[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new TypeError("event file must be an array");

  return parsed.map((entry, index) => {
    const event = entry as Record<string, unknown>;
    const common = {
      blockNumber: toBigInt(event.blockNumber, `[${index}].blockNumber`),
      txHash: event.txHash as SettlementEvent["txHash"],
      logIndex: Number(event.logIndex ?? 0),
      security: event.security as SettlementEvent["security"],
    };

    if (event.kind === "settlement") {
      return {
        kind: "settlement",
        id: event.id as SettlementEvent["txHash"],
        seller: event.seller as `0x${string}`,
        buyer: event.buyer as `0x${string}`,
        quantity: toBigInt(event.quantity, `[${index}].quantity`),
        consideration: toBigInt(event.consideration, `[${index}].consideration`),
        ...common,
      } satisfies SettlementEvent;
    }

    if (event.kind === "session") {
      return {
        kind: "session",
        session: toBigInt(event.session, `[${index}].session`),
        legs: Number(event.legs),
        grossTrades: Number(event.grossTrades),
        ...common,
      } satisfies SettlementEvent;
    }

    throw new TypeError(`[${index}].kind must be settlement or session`);
  });
}

export function run(argv: readonly string[]): number {
  const [command, file, extra] = argv;

  try {
    switch (command) {
      case "summary": {
        if (!file) throw new TypeError("summary requires an event file");
        console.log(summary(inChainOrder(parseEvents(readFileSync(file, "utf8")))));
        return 0;
      }
      case "positions": {
        if (!file) throw new TypeError("positions requires an event file");
        const events = inChainOrder(parseEvents(readFileSync(file, "utf8")));
        console.log(positionTable(events, extra as SettlementEvent["security"] | undefined));
        return 0;
      }
      case "help":
      case "--help":
      case undefined:
        console.log(USAGE);
        return 0;
      default:
        console.error(`unknown command: ${command}`);
        console.error(USAGE);
        return 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run(process.argv.slice(2)));
}
