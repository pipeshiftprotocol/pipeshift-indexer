/**
 * Chain definitions and client construction.
 *
 * Robinhood Chain is not in viem's chain registry, so it is defined here rather
 * than imported. The id and RPC come from configuration so the same build works
 * against mainnet, a devnet, or a local anvil.
 */

import { createPublicClient, defineChain, http, type PublicClient } from "viem";

/** Robinhood Chain, as configured for this deployment. */
export const robinhoodChain = defineChain({
  id: Number(process.env.PIPESHIFT_CHAIN_ID ?? 4663),
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.PIPESHIFT_RPC_URL ?? "http://127.0.0.1:8545"],
    },
  },
});

export interface ClientOptions {
  /** RPC endpoint. Falls back to PIPESHIFT_RPC_URL, then to a local node. */
  rpcUrl?: string;
  /** Chain id. Falls back to PIPESHIFT_CHAIN_ID, then to Robinhood Chain. */
  chainId?: number;
  /** Requests per batch. Set to 0 to disable batching. */
  batchSize?: number;
}

/**
 * Builds a read only client.
 *
 * There is no wallet client anywhere in this package, which is what makes the
 * read only claim in the README structural rather than a promise.
 */
export function publicClientFor(options: ClientOptions = {}): PublicClient {
  const rpcUrl = options.rpcUrl ?? process.env.PIPESHIFT_RPC_URL ?? "http://127.0.0.1:8545";
  const chainId = options.chainId ?? Number(process.env.PIPESHIFT_CHAIN_ID ?? 4663);

  const chain = defineChain({ ...robinhoodChain, id: chainId });

  return createPublicClient({
    chain,
    transport: http(rpcUrl, {
      batch: options.batchSize === 0 ? false : { batchSize: options.batchSize ?? 20 },
      retryCount: 3,
      retryDelay: 250,
    }),
  }) as PublicClient;
}

/** Addresses of the deployed Pipeshift contracts. */
export interface Deployment {
  settlementEngine: `0x${string}`;
  nettingEngine: `0x${string}`;
  assetRegistry: `0x${string}`;
}

/** Thrown when a required address is missing or malformed. */
export class MissingDeploymentError extends Error {
  constructor(field: string) {
    super(`${field} is not set. Pass it explicitly or set the matching env var.`);
    this.name = "MissingDeploymentError";
  }
}

const isAddress = (value: string | undefined): value is `0x${string}` =>
  typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);

/**
 * Reads a deployment from the environment.
 *
 * Every address is validated rather than trusted, because an indexer pointed at a
 * mistyped address silently reports an empty range instead of failing.
 */
export function deploymentFromEnv(env: NodeJS.ProcessEnv = process.env): Deployment {
  const settlementEngine = env.PIPESHIFT_SETTLEMENT_ENGINE;
  const nettingEngine = env.PIPESHIFT_NETTING_ENGINE;
  const assetRegistry = env.PIPESHIFT_ASSET_REGISTRY;

  if (!isAddress(settlementEngine)) throw new MissingDeploymentError("PIPESHIFT_SETTLEMENT_ENGINE");
  if (!isAddress(nettingEngine)) throw new MissingDeploymentError("PIPESHIFT_NETTING_ENGINE");
  if (!isAddress(assetRegistry)) throw new MissingDeploymentError("PIPESHIFT_ASSET_REGISTRY");

  return { settlementEngine, nettingEngine, assetRegistry };
}
