<div align="center">

<img src="assets/banner.jpg" alt="Pipeshift" width="100%">

### Event indexer for Pipeshift settlement

Turns settled instructions and netting sessions into positions, volumes and compression.

[![License: MIT](https://img.shields.io/badge/license-MIT-0AE8A6.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.6-0AE8A6.svg?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/tests-30%20passing-0AE8A6.svg?style=flat-square)](.github/workflows/ci.yml)
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
