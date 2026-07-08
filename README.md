<div align="center">

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
