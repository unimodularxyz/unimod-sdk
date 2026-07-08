/**
 * liquidity.ts — the LP surface: proportional add/remove + Star-only zaps.
 *
 * Proportional previews are computed client-side from `poolSummary` (pro-rata on balances /
 * totalLpShares) — estimates, not quotes; the mint fee and price drift land on the guard, so
 * every write takes a `slippageBps` (default 100 = 1%). Zap previews are exact `Lens` reads.
 * Preconditions: Permit2 approvals for input tokens (onboard.ts `ensurePermit2Approval`);
 * `removeLiquidity`/`zapOut` additionally need the ERC6909 operator (`ensureLpOperator`).
 */

import type { Address, Hex } from "viem";
import { encodePacked, keccak256 } from "viem";
import { writePadded, type UnimodClient } from "./client.js";
import { lensAbi, routerAbi } from "./abis.js";
import { deadline as defaultDeadline, minOut } from "./units.js";

/** ERC6909 token id of a pool's LP share (`TokenId.lpShare`: keccak256(0x01 ++ poolId)). */
export const lpShareId = (poolId: Hex): bigint => BigInt(keccak256(encodePacked(["uint8", "bytes32"], [1, poolId])));

const maxIn = (quoted: bigint, slippageBps: bigint): bigint => (quoted * (10_000n + slippageBps)) / 10_000n;

async function readSummary(uni: UnimodClient, poolId: Hex) {
  return uni.public.readContract({ address: uni.addresses.lens, abi: lensAbi, functionName: "poolSummary", args: [poolId] });
}

/** Pro-rata estimate for a proportional add capped by `maxAmounts`: the binding asset sets the LP out. */
export async function previewAddLiquidity(
  uni: UnimodClient,
  poolId: Hex,
  maxAmounts: bigint[],
): Promise<{ lpShares: bigint; amounts: bigint[] }> {
  const s = await readSummary(uni, poolId);
  let lpShares = 0n;
  for (let i = 0; i < s.balances.length; i++) {
    const b = s.balances[i];
    if (b === undefined || b === 0n) continue;
    const lp = ((maxAmounts[i] ?? 0n) * s.totalLpShares) / b;
    if (lpShares === 0n || lp < lpShares) lpShares = lp;
  }
  const amounts = s.balances.map((b) => (b * lpShares + s.totalLpShares - 1n) / s.totalLpShares);
  return { lpShares, amounts };
}

/** Pro-rata estimate of the per-asset output of burning `lpShares` proportionally. */
export async function previewRemoveLiquidity(uni: UnimodClient, poolId: Hex, lpShares: bigint): Promise<bigint[]> {
  const s = await readSummary(uni, poolId);
  return s.balances.map((b) => (b * lpShares) / s.totalLpShares);
}

export interface AddLiquidityArgs {
  poolId: Hex;
  tokens: Address[]; // pool asset order
  maxAmounts: bigint[]; // token-native decimals, caps per asset
  recipient: Address;
  slippageBps?: bigint; // guard on the LP estimate; default 100 = 1%
  deadline?: bigint;
}

/** Proportional mint: charges up to `maxAmounts`, refunds the slack. Works on Star AND Delta. */
export async function addLiquidity(uni: UnimodClient, args: AddLiquidityArgs): Promise<Hex> {
  if (!uni.wallet) throw new Error("addLiquidity needs a wallet client");
  const { lpShares } = await previewAddLiquidity(uni, args.poolId, args.maxAmounts);

  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "addLiquidity",
    args: [
      args.poolId,
      args.tokens,
      args.maxAmounts,
      minOut(lpShares, args.slippageBps ?? 100n),
      args.recipient,
      args.deadline ?? defaultDeadline(),
    ],
    account: args.recipient,
    chain: uni.wallet.chain,
  });
}

export interface RemoveLiquidityArgs {
  poolId: Hex;
  tokens: Address[]; // pool asset order
  lpShares: bigint;
  recipient: Address;
  slippageBps?: bigint; // guard on the per-asset estimates; default 100 = 1%
  deadline?: bigint;
}

/** Proportional burn (no fee). Precondition: `ensureLpOperator` — the Router pulls the ERC6909 LP. */
export async function removeLiquidity(uni: UnimodClient, args: RemoveLiquidityArgs): Promise<Hex> {
  if (!uni.wallet) throw new Error("removeLiquidity needs a wallet client");
  const quoted = await previewRemoveLiquidity(uni, args.poolId, args.lpShares);

  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "removeLiquidity",
    args: [
      args.poolId,
      args.tokens,
      args.lpShares,
      quoted.map((q) => minOut(q, args.slippageBps ?? 100n)),
      args.recipient,
      args.deadline ?? defaultDeadline(),
    ],
    account: args.recipient,
    chain: uni.wallet.chain,
  });
}

/** Exact fee-inclusive input cost of minting `lpSharesOut` via a single-asset zap. Star only. */
export async function previewZapIn(uni: UnimodClient, poolId: Hex, assetIndex: bigint, lpSharesOut: bigint): Promise<bigint> {
  const [, amountIn] = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "previewZapIn",
    args: [poolId, assetIndex, lpSharesOut],
  });
  return amountIn;
}

/** Exact post-fee output of burning `lpSharesIn` into one asset. Star only. */
export async function previewZapOut(uni: UnimodClient, poolId: Hex, assetIndex: bigint, lpSharesIn: bigint): Promise<bigint> {
  const [, amountOut] = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "previewZapOut",
    args: [poolId, assetIndex, lpSharesIn],
  });
  return amountOut;
}

export interface ZapInArgs {
  poolId: Hex;
  assetIndex: bigint;
  lpSharesOut: bigint;
  recipient: Address;
  slippageBps?: bigint; // default 100 = 1%
  deadline?: bigint;
}

/** Single-asset entry targeting exact LP out. Star only (`UnsupportedForDeltaPool` on Delta). */
export async function zapIn(uni: UnimodClient, args: ZapInArgs): Promise<Hex> {
  if (!uni.wallet) throw new Error("zapIn needs a wallet client");
  const quoted = await previewZapIn(uni, args.poolId, args.assetIndex, args.lpSharesOut);

  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "zapIn",
    args: [
      args.poolId,
      args.assetIndex,
      args.lpSharesOut,
      maxIn(quoted, args.slippageBps ?? 100n),
      args.recipient,
      args.deadline ?? defaultDeadline(),
    ],
    account: args.recipient,
    chain: uni.wallet.chain,
  });
}

export interface ZapOutArgs {
  poolId: Hex;
  assetIndex: bigint;
  lpSharesIn: bigint;
  recipient: Address;
  slippageBps?: bigint; // default 100 = 1%
  deadline?: bigint;
}

/** Single-asset exit of exact LP in. Star only. Precondition: `ensureLpOperator`. */
export async function zapOut(uni: UnimodClient, args: ZapOutArgs): Promise<Hex> {
  if (!uni.wallet) throw new Error("zapOut needs a wallet client");
  const quoted = await previewZapOut(uni, args.poolId, args.assetIndex, args.lpSharesIn);

  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "zapOut",
    args: [
      args.poolId,
      args.assetIndex,
      args.lpSharesIn,
      minOut(quoted, args.slippageBps ?? 100n),
      args.recipient,
      args.deadline ?? defaultDeadline(),
    ],
    account: args.recipient,
    chain: uni.wallet.chain,
  });
}
