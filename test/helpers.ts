/** Shared fixtures for integration tests: clients over the anvil chain booted in global setup. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addressesFromDeployments, createUnimodClient, type UnimodClient } from "../src/index.js";

const runtime = JSON.parse(readFileSync(join(__dirname, "setup/.runtime.json"), "utf8")) as {
  rpc: string;
  deployments: {
    chainId: number;
    contracts: Record<string, string>;
    tokens: Record<string, { address: string; symbol: string; decimals: number; assetId: number }>;
    pools: Record<string, { poolId: string; assets: number[]; marketId: number; poolType: string }>;
  };
};

export const deployments = runtime.deployments;
export const chain = defineChain({
  id: deployments.chainId,
  name: "unimod-test",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [runtime.rpc] } },
});

// Anvil's well-known accounts: #0 deploys, #1 is the seeded demo user, #2 starts empty,
// #3/#4 are the liquidation scenario (borrower, keeper), #5/#6 the liquidity and swap files.
// One account per test FILE: vitest's file order is nondeterministic, so files must never
// share mutable account state.
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  user: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  fresh: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  borrower: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  keeper: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  lp: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  swapper: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
} as const;

export const publicClient = createPublicClient({ chain, transport: http(runtime.rpc) });

export function clientFor(who: keyof typeof KEYS): { uni: UnimodClient; account: Address } {
  const account = privateKeyToAccount(KEYS[who] as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(runtime.rpc) });
  return { uni: createUnimodClient({ public: publicClient, wallet, addresses: addressesFromDeployments(deployments) }), account: account.address };
}

export const tokens = ["A", "B", "C"].map((k) => {
  const t = deployments.tokens[k]!;
  return { ...t, address: t.address as Address };
});
export const starPool = (deployments.pools.star3 ?? deployments.pools.star)!;
export const poolId = starPool.poolId as Hex;
/** Map pool asset position → token meta (pool assets are sorted assetIds). */
export const poolTokens = starPool.assets.map((id) => tokens.find((t) => t.assetId === id)!);

export async function mined(hash: Hex): Promise<void> {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
}

export async function balanceOf(token: Address, owner: Address): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    functionName: "balanceOf",
    args: [owner],
  });
}

/** ERC20Mock.mint is permissionless — the tests' faucet. */
export async function mintTo(from: { uni: UnimodClient }, token: Address, to: Address, amount: bigint): Promise<void> {
  if (!from.uni.wallet) throw new Error("mintTo needs a wallet client");
  const hash = await from.uni.wallet.writeContract({
    address: token,
    abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const,
    functionName: "mint",
    args: [to, amount],
    account: from.uni.wallet.account!,
    chain,
  });
  await mined(hash);
}

/** Anvil time travel: jump forward and mine, so lazy interest accrual has something to accrue. */
export async function warp(seconds: number): Promise<void> {
  await publicClient.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
  await publicClient.request({ method: "evm_mine" as never, params: [] as never });
}
