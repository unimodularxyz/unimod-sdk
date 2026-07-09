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
  // Prefer the wallet's hoisted Account object: an address-only `account` makes viem fall back
  // to eth_sendTransaction (node-side signing), which only works for node-owned dev accounts.
  const account = uni.wallet.account ?? (params as { account?: unknown }).account;
  return uni.wallet.writeContract({ ...params, account, gas: (gas * 130n) / 100n } as WriteParams);
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

/** Execute several Router calls atomically in ONE transaction (Router.multicall self-delegatecalls). */
export async function multicallRouter(
  uni: UnimodClient,
  args: { calls: readonly `0x${string}`[]; account: Address },
): Promise<`0x${string}`> {
  if (!uni.wallet) throw new Error("multicallRouter needs a wallet client");
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: [
      {
        type: "function",
        name: "multicall",
        stateMutability: "nonpayable",
        inputs: [{ name: "data", type: "bytes[]" }],
        outputs: [{ name: "results", type: "bytes[]" }],
      },
    ] as const,
    functionName: "multicall",
    args: [args.calls],
    account: args.account,
    chain: uni.wallet.chain,
  });
}
