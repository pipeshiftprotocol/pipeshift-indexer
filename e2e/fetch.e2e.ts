/**
 * End to end suite against a real node.
 *
 * Deploys the emitter fixture, sends real transactions, then reads the resulting
 * logs back through the same code path production uses: viem getLogs, adaptive
 * chunking, the engine enricher and the aggregation layer.
 *
 * The unit tests prove the aggregation is correct. This proves the indexer can
 * actually read a chain, which no amount of mocking establishes.
 *
 * Run with: npm run e2e:full
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { chunkRange, fetchEvents } from "../dist/fetch.js";
import { compressionOf, positionsOf, statsOf } from "../dist/aggregate.js";
import { summary } from "../dist/report.js";
import type { Deployment } from "../dist/chain.js";
import type { Hex32 } from "../dist/types.js";
import { emitterBytecode } from "./fixtures/emitter.ts";

const RPC_URL = process.env.PIPESHIFT_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.PIPESHIFT_CHAIN_ID ?? 31337);

const DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const devnet = defineChain({
  id: CHAIN_ID,
  name: "Pipeshift devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const emitterAbi = parseAbi([
  "function settle(bytes32 id, bytes32 security, address seller, address buyer, uint256 quantity, uint256 consideration)",
  "function session(uint256 id, bytes32 security, uint256 legs, uint256 grossTrades)",
]);

const AAPL = "0x39095d275eb1261bd6276da1dd2eaaf6ad0ae3a60a9667abc65ac90d583b11ac" as Hex32;
const TSLA = "0x5f2c1b8e7a9d3c4f6b8a0e2d4c6f8a0b2d4e6f8a0c2e4d6f8b0a2c4e6d8f0a2c" as Hex32;

const deskA = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const deskB = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const deskC = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;

const id = (n: number): Hex32 => `0x${n.toString(16).padStart(64, "0")}` as Hex32;

describe("indexing a live node", () => {
  let publicClient: PublicClient;
  let wallet: WalletClient;
  let deployment: Deployment;
  let firstBlock: bigint;

  before(async () => {
    publicClient = createPublicClient({ chain: devnet, transport: http(RPC_URL) }) as PublicClient;
    wallet = createWalletClient({
      account: privateKeyToAccount(DEPLOYER),
      chain: devnet,
      transport: http(RPC_URL),
    });

    assert.equal(await publicClient.getChainId(), CHAIN_ID, "connected to the expected chain");

    const deployHash = await wallet.deployContract({
      abi: emitterAbi,
      bytecode: emitterBytecode as `0x${string}`,
      chain: devnet,
      account: wallet.account!,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    assert.ok(receipt.contractAddress, "the emitter deployed");

    const emitter = receipt.contractAddress!;
    firstBlock = receipt.blockNumber;

    // The indexer reads both engine addresses. Here one contract plays both roles.
    deployment = {
      settlementEngine: emitter,
      nettingEngine: emitter,
      assetRegistry: emitter,
    };

    const send = async (
      functionName: "settle" | "session",
      args: readonly unknown[],
    ): Promise<void> => {
      const hash = await wallet.writeContract({
        address: emitter,
        abi: emitterAbi,
        functionName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: args as any,
        chain: devnet,
        account: wallet.account!,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    };

    // Two settlements that partly offset, then two netting sessions.
    await send("settle", [id(1), AAPL, deskA, deskB, 400n * 10n ** 18n, 82_000n * 10n ** 6n]);
    await send("settle", [id(2), AAPL, deskB, deskC, 150n * 10n ** 18n, 30_800n * 10n ** 6n]);
    await send("settle", [id(3), AAPL, deskB, deskA, 380n * 10n ** 18n, 78_090n * 10n ** 6n]);
    await send("session", [41n, AAPL, 6n, 12_000n]);
    await send("session", [42n, TSLA, 4n, 3_100n]);
  });

  it("reads its own transactions back from the chain", async () => {
    const events = await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: firstBlock,
    });

    assert.equal(events.length, 5, "three settlements and two sessions");
    assert.equal(events.filter((e) => e.kind === "settlement").length, 3);
    assert.equal(events.filter((e) => e.kind === "session").length, 2);
  });

  it("recovers amounts that the event does not carry", async () => {
    const events = await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: firstBlock,
    });

    const settlement = events.find((e) => e.kind === "settlement" && e.id === id(1));
    assert.ok(settlement, "the first settlement was decoded");
    if (settlement?.kind === "settlement") {
      // These numbers exist only in contract storage, never in the log itself.
      assert.equal(settlement.quantity, 400n * 10n ** 18n);
      assert.equal(settlement.consideration, 82_000n * 10n ** 6n);
      assert.equal(settlement.security, AAPL);
      assert.equal(settlement.seller.toLowerCase(), deskA.toLowerCase());
    }
  });

  it("produces the same positions from the chain as from a file", async () => {
    const events = await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: firstBlock,
    });

    const positions = positionsOf(events);
    const byParty = new Map(positions.map((p) => [p.party.toLowerCase(), p]));

    // deskA sold 400 and bought 380 back, so it ends 20 short.
    assert.equal(byParty.get(deskA.toLowerCase())?.quantity, -20n * 10n ** 18n);
    assert.equal(byParty.get(deskA.toLowerCase())?.trades, 2);

    // deskB sold 150 and 380, bought 400: net short 130.
    assert.equal(byParty.get(deskB.toLowerCase())?.quantity, -130n * 10n ** 18n);

    // deskC only bought.
    assert.equal(byParty.get(deskC.toLowerCase())?.quantity, 150n * 10n ** 18n);
  });

  it("reports compression over the real range", async () => {
    const events = await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: firstBlock,
    });

    const report = compressionOf(events);
    assert.equal(report.grossSettlements, 3);
    assert.equal(report.nettedTrades, 15_100);
    assert.equal(report.transfers, 26, "six for settlements, twenty for ten legs");
    assert.ok(report.ratio > 0.99);

    const stats = statsOf(events);
    assert.equal(stats.length, 2, "two securities appeared");
    assert.equal(stats[0]?.security, AAPL, "aapl carried the most trades");

    const text = summary(events);
    assert.match(text, /securities {6}2/);
  });

  it("survives a chunk size of one block", async () => {
    const head = await publicClient.getBlockNumber();

    const events = await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: firstBlock,
      toBlock: head,
      chunkSize: 1n,
    });

    assert.equal(events.length, 5, "chunking does not lose or duplicate events");
  });

  it("reports progress per chunk", async () => {
    const seen: Array<[bigint, bigint, number]> = [];

    await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: firstBlock,
      chunkSize: 2n,
      onProgress: (from, to, found) => seen.push([from, to, found]),
    });

    assert.ok(seen.length > 1, "more than one chunk was requested");
    assert.equal(
      seen.reduce((sum, [, , found]) => sum + found, 0),
      5,
      "progress accounts for every event",
    );
  });

  it("returns nothing for a range with no settlement activity", async () => {
    const head = await publicClient.getBlockNumber();

    const events = await fetchEvents({
      client: publicClient,
      deployment,
      fromBlock: head + 1n,
      toBlock: head + 1n,
    });

    assert.deepEqual(events, []);
  });

  it("chunks a range the way the fetcher does", () => {
    assert.deepEqual(chunkRange(10n, 12n, 5n), [[10n, 12n]]);
    assert.deepEqual(chunkRange(0n, 9n, 5n), [
      [0n, 4n],
      [5n, 9n],
    ]);
    assert.deepEqual(chunkRange(5n, 4n, 5n), [], "an empty range yields no chunks");
  });
});
