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

type WriteParams = Parameters<WalletClient["writeContract"]>[0];

/**
 * writeContract with a 30% gas buffer over an explicit estimate. Unimod's gas cost is
 * TIME-DEPENDENT: interest accrual and SPM multipliers do more work when block.timestamp has
 * advanced since the last interaction, so an exact `eth_estimateGas` taken in second N can
 * OutOfGas when the tx lands in second N+1. Every SDK write goes through this.
 */
export async function writePadded(uni: UnimodClient, params: WriteParams): Promise<`0x${string}`> {
  if (!uni.wallet) throw new Error("write needs a wallet client");
  const gas = await uni.public.estimateContractGas(params as never);
  return uni.wallet.writeContract({ ...params, gas: (gas * 130n) / 100n } as WriteParams);
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
