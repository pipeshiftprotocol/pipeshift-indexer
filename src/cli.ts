#!/usr/bin/env node
/**
 * Pipeshift indexer command line.
 *
 * Reads a JSON file of already decoded events and prints reports. Keeping the
 * chain access outside the CLI means the reports are reproducible from a file and
 * reviewable in a pull request.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deploymentFromEnv, publicClientFor } from "./chain.js";
import { fetchEvents } from "./fetch.js";
import { assertOrdered, inChainOrder, positionsOf } from "./aggregate.js";
import { positionTable, positionsCsv, summary } from "./report.js";
import type { SettlementEvent } from "./types.js";

const USAGE = `pipeshift-index <command> <events.json> [options]

Commands
  summary <file>            Totals, compression and per security lines
  positions <file> [id]     Net positions, optionally for one security
  csv <file>                Positions as csv on stdout
  check <file>              Verify the file is in chain order
  fetch <out.json>          Read events from a node and write them to a file
  help                      Show this message

Environment for fetch
  PIPESHIFT_RPC_URL             node endpoint
  PIPESHIFT_CHAIN_ID            defaults to 4663
  PIPESHIFT_SETTLEMENT_ENGINE   deployed address
  PIPESHIFT_NETTING_ENGINE      deployed address
  PIPESHIFT_ASSET_REGISTRY      deployed address
  PIPESHIFT_FROM_BLOCK          first block to read, defaults to 0

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

/** Serialises events back to the on disk shape, bigint as decimal strings. */
function serialise(events: readonly SettlementEvent[]): string {
  return JSON.stringify(
    events.map((event) =>
      Object.fromEntries(
        Object.entries(event).map(([key, value]) => [
          key,
          typeof value === "bigint" ? value.toString() : value,
        ]),
      ),
    ),
    null,
    2,
  );
}

/** Reads a live range from a node and writes it out as an event file. */
async function commandFetch(out: string | undefined, fromArg: string | undefined): Promise<number> {
  if (!out) throw new TypeError("fetch requires an output file");

  const client = publicClientFor();
  const deployment = deploymentFromEnv();
  const fromBlock = BigInt(fromArg ?? process.env.PIPESHIFT_FROM_BLOCK ?? "0");
  const head = await client.getBlockNumber();

  console.error(`reading blocks ${fromBlock}..${head}`);

  const events = await fetchEvents({
    client,
    deployment,
    fromBlock,
    toBlock: head,
    onProgress: (from, to, found) => {
      if (found > 0) console.error(`  ${from}..${to}  ${found} events`);
    },
  });

  writeFileSync(out, serialise(events) + "\n");
  console.error(`wrote ${events.length} events to ${out}`);
  return 0;
}

export function run(argv: readonly string[]): number | Promise<number> {
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
      case "csv": {
        if (!file) throw new TypeError("csv requires an event file");
        const events = inChainOrder(parseEvents(readFileSync(file, "utf8")));
        console.log(positionsCsv(positionsOf(events)));
        return 0;
      }
      case "check": {
        if (!file) throw new TypeError("check requires an event file");
        assertOrdered(parseEvents(readFileSync(file, "utf8")));
        console.log("ordered");
        return 0;
      }
      case "fetch":
        return commandFetch(file, extra);
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
  const code = run(process.argv.slice(2));
  if (typeof code === "number") {
    process.exit(code);
  } else {
    code.then((value) => process.exit(value)).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  }
}
