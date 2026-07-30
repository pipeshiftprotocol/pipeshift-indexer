<div align="center">

<img src="assets/banner.jpg" alt="Pipeshift" width="100%">

### Event indexer for Pipeshift settlement

Turns settled instructions and netting sessions into positions, volumes and compression.

[![License: MIT](https://img.shields.io/badge/license-MIT-0AE8A6.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.6-0AE8A6.svg?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/tests-38%20passing-0AE8A6.svg?style=flat-square)](.github/workflows/ci.yml)
[![E2E](https://img.shields.io/badge/e2e-live%20node-0AE8A6.svg?style=flat-square)](e2e)
[![Chain](https://img.shields.io/badge/chain-Robinhood%20Chain-221B1D.svg?style=flat-square)](https://pipeshift.trade)

[**What it does**](#what-it-does) ·
[**CLI**](#cli) ·
[**Library**](#library) ·
[**Design notes**](#design-notes) ·
[**Limits**](#what-this-cannot-do)

</div>

---

## What it does

The [settlement engines](https://github.com/pipeshiftprotocol/pipeshift) emit two events:
`InstructionSettled` when a matched trade moves both legs, and `SessionSettled` when a
netting session collapses many trades into net positions.

This package reads those events and answers the questions an operator actually has. Who
ended the day long. How much moved in a security. How many transfers netting removed
against settling everything gross.

Read only by construction. There is no signer in this package and nothing here can send a
transaction.

## CLI

```bash
$ pipeshift-index summary examples/events.json
blocks          8421100 .. 8421187
events          4
securities      2
settlements     2
netted trades   15100
transfers       24
if settled gross 30204
compression     99.92%

security        trades  parties          quantity volume
0x39095d27..11ac 12002        3     550000000000000000000
0x5f2c1b8e..0a2c  3100        0                         0
```

```bash
$ pipeshift-index positions examples/events.json
party                       trades                    quantity                cash
0x111111111111111111..1111     1      -400000000000000000000         82000000000
0x222222222222222222..2222     2       250000000000000000000        -51200000000
0x333333333333333333..3333     1       150000000000000000000        -30800000000
```

| Command | What it does |
|---|---|
| `summary <file>` | Range, totals, compression, per security lines |
| `positions <file> [security]` | Net positions, ranked by absolute quantity |
| `csv <file>` | Positions as csv on stdout |
| `check <file>` | Verifies the file is in chain order |

The CLI reads a file of decoded events rather than talking to a node itself. That keeps a
report reproducible from an input you can commit and review, instead of depending on
whatever an RPC returned that afternoon.

## Reading a live chain

```bash
export PIPESHIFT_RPC_URL=https://rpc.mainnet.chain.robinhood.com
export PIPESHIFT_CHAIN_ID=4663
export PIPESHIFT_SETTLEMENT_ENGINE=0x...
export PIPESHIFT_NETTING_ENGINE=0x...
export PIPESHIFT_ASSET_REGISTRY=0x...

pipeshift-index fetch events.json 8400000    # from block, defaults to PIPESHIFT_FROM_BLOCK
pipeshift-index summary events.json
```

`fetch` walks the range in chunks, halving a chunk whenever the provider rejects it, so a
public endpoint with an undocumented limit degrades into more requests rather than an error.
Ranges past the head are clamped instead of rejected. Amounts that the event does not carry
are read back from the settlement engine and cached per instruction id.

### End to end

```bash
npm run e2e:full
```

Starts anvil, deploys the [emitter fixture](e2e/fixtures/Emitter.sol), sends real
transactions, then reads them back through the same path production uses. It asserts that
positions computed from the chain match the ones computed from a file, that amounts absent
from the log are recovered from storage, and that a chunk size of one block loses nothing.

## Library

```ts
import { compressionOf, decodeLogs, positionsOf, statsOf } from "@pipeshift/indexer";

const events = decodeLogs(logs, (id) => instructionCache.get(id));

const positions = positionsOf(events);
const perSecurity = statsOf(events);
const compression = compressionOf(events);

console.log(`${compression.transfers} transfers instead of ${compression.transfersIfGross}`);
```

`decodeLogs` takes an enricher because `InstructionSettled` indexes the parties but not the
amounts: amounts live in the stored instruction. A log whose amounts cannot be resolved is
skipped rather than recorded with zeros.

## Design notes

**Sessions do not name their counterparties.** `SessionSettled` reports how many legs moved
and how many trades that represented, not who was on each side. So sessions contribute to
volume and compression but never to positions. Splitting a session across parties would mean
inventing counterparties the log does not name.

**Aggregation is pure.** No chain access, no clock, no I/O below the CLI. Every number this
package produces is a function of the events handed to it, which is why the tests cover the
interesting cases without a node.

**Order is checked, not assumed.** `assertOrdered` rejects a block going backwards or a
repeated log index inside one block, because a silently reordered range produces plausible
and wrong running totals.

**Amounts stay bigint.** Nothing in the pipeline converts an amount to a number, and the CLI
rejects number literals in input files. A float that reaches a settlement figure is a
position break waiting to be found.

## What this cannot do

- It fetches logs over plain JSON-RPC. There is no websocket subscription and no reorg handling: a range is read once, as it stood at the head when asked.
- It has no database. State is derived from the events you supply, every run.
- It does not track cash balances outside settled trades, so a desk funding its account is invisible here.
- It cannot attribute a netting session to individual desks. See the design note above.
- Nothing is deployed to Robinhood Chain mainnet yet, so in practice this runs against test data today.

## License

MIT. See [LICENSE](LICENSE).

<div align="center">

[pipeshift.trade](https://pipeshift.trade) · [@pipeshift_ai](https://x.com/pipeshift_ai) · [main repo](https://github.com/pipeshiftprotocol/pipeshift)

</div>
