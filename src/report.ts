/**
 * Text reports.
 *
 * Fixed width output so a report can be diffed between runs and read in a
 * terminal without a wide window.
 */

import { compressionOf, positionsOf, statsOf, stateOf } from "./aggregate.js";
import type { Hex32, Position, SettlementEvent } from "./types.js";

const short = (value: string, keep = 10): string =>
  value.length <= keep + 4 ? value : `${value.slice(0, keep)}..${value.slice(-4)}`;

/** Right-pads a signed bigint into a fixed column. */
const amount = (value: bigint, width = 24): string => value.toString().padStart(width);

/** Summary of an indexed range: totals, compression, per security lines. */
export function summary(events: readonly SettlementEvent[]): string {
  const state = stateOf(events);
  const compression = compressionOf(events);
  const stats = statsOf(events);

  const lines: string[] = [];
  lines.push(`blocks          ${state.fromBlock} .. ${state.toBlock}`);
  lines.push(`events          ${state.events}`);
  lines.push(`securities      ${state.securities}`);
  lines.push(`settlements     ${compression.grossSettlements}`);
  lines.push(`netted trades   ${compression.nettedTrades}`);
  lines.push(`transfers       ${compression.transfers}`);
  lines.push(`if settled gross ${compression.transfersIfGross}`);
  lines.push(`compression     ${(compression.ratio * 100).toFixed(2)}%`);

  if (stats.length > 0) {
    lines.push("");
    lines.push("security        trades  parties          quantity volume");
    for (const entry of stats) {
      lines.push(
        `${short(entry.security).padEnd(16)}${String(entry.grossTrades).padStart(6)}` +
          `${String(entry.parties).padStart(9)}${amount(entry.volumeQuantity, 26)}`,
      );
    }
  }

  return lines.join("\n");
}

/** Net positions, largest absolute quantity first. */
export function positionTable(events: readonly SettlementEvent[], security?: Hex32): string {
  let positions = positionsOf(events);
  if (security) {
    positions = positions.filter((p) => p.security.toLowerCase() === security.toLowerCase());
  }

  const ranked = [...positions].sort((a, b) => {
    const left = a.quantity < 0n ? -a.quantity : a.quantity;
    const right = b.quantity < 0n ? -b.quantity : b.quantity;
    return left === right ? 0 : left > right ? -1 : 1;
  });

  const lines = ["party                       trades                    quantity                cash"];
  for (const position of ranked) {
    lines.push(
      `${short(position.party, 20).padEnd(26)}${String(position.trades).padStart(6)}` +
        `${amount(position.quantity, 28)}${amount(position.cash, 20)}`,
    );
  }

  return lines.join("\n");
}

/** One line per party for machine consumption. */
export function positionsCsv(positions: readonly Position[]): string {
  const rows = ["party,security,quantity,cash,trades"];
  for (const p of positions) {
    rows.push(`${p.party},${p.security},${p.quantity},${p.cash},${p.trades}`);
  }
  return rows.join("\n");
}
