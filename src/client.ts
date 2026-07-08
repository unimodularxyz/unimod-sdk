/**
 * client.ts — the SDK handle: addresses + viem clients.
 *
 * Construct once and pass to every helper. `wallet` is optional — read helpers only need `public`.
 */

import type { Address, PublicClient, WalletClient } from "viem";

export interface UnimodAddresses {
  unimod: Address; // AMM core — ERC6909 LP shares live here (operator approvals, balances)
  router: Address;
  lens: Address;
  lending: Address;
  registry: Address;
  permit2: Address;
}

export interface UnimodClient {
  public: PublicClient;
  wallet?: WalletClient;
  addresses: UnimodAddresses;
}

export function createUnimodClient(args: {
  public: PublicClient;
  wallet?: WalletClient;
  addresses: UnimodAddresses;
}): UnimodClient {
  return { public: args.public, wallet: args.wallet, addresses: args.addresses };
}

/**
 * Pull addresses out of a `deployments/{chainId}.json` bundle (written by the contracts deploy script).
 * Shape: `{ contracts: { unimod, router, lens, lending, marketRegistry, permit2 } }`.
 */
export function addressesFromDeployments(json: { contracts: Record<string, string> }): UnimodAddresses {
  const c = json.contracts;
  return {
    unimod: c.unimod as Address,
    router: c.router as Address,
    lens: c.lens as Address,
    lending: c.lending as Address,
    registry: c.marketRegistry as Address,
    permit2: c.permit2 as Address,
  };
}
