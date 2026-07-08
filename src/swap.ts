/**
 * swap.ts — the Swap surface. Preview → slippage-guarded swapExactIn / swapExactOut.
 *
 * Amounts are token-NATIVE decimals on both sides. Re-quote right before submitting —
 * pool prices drift after every swap. Precondition: Permit2 approval for `tokenIn` (see onboard.ts).
 */

import type { Address, Hex } from "viem";
import type { UnimodClient } from "./client.js";
import { lensAbi, routerAbi } from "./abis.js";
import { deadline as defaultDeadline, minOut } from "./units.js";

/** Free quote: post-fee output of `amountIn` of `assetIn` → `assetOut`. */
export async function previewSwap(
  uni: UnimodClient,
  poolId: Hex,
  assetInIndex: bigint,
  assetOutIndex: bigint,
  amountIn: bigint,
): Promise<bigint> {
  const [, amountOut] = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "previewSwapIn",
    args: [poolId, assetInIndex, assetOutIndex, amountIn],
  });
  return amountOut;
}

export interface SwapArgs {
  poolId: Hex;
  tokenIn: Address;
  tokenOut: Address;
  assetInIndex: bigint;
  assetOutIndex: bigint;
  amountIn: bigint;
  recipient: Address;
  slippageBps?: bigint; // default 50 = 0.5%
  deadline?: bigint; // default now + 20min
}

/** Quote, derive a min-out floor, and submit. Requires `uni.wallet`. */
export async function swapExactIn(uni: UnimodClient, args: SwapArgs): Promise<Hex> {
  if (!uni.wallet) throw new Error("swapExactIn needs a wallet client");
  const quoted = await previewSwap(uni, args.poolId, args.assetInIndex, args.assetOutIndex, args.amountIn);

  return uni.wallet.writeContract({
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "swapExactIn",
    args: [
      args.poolId,
      args.tokenIn,
      args.tokenOut,
      args.assetInIndex,
      args.assetOutIndex,
      args.amountIn,
      minOut(quoted, args.slippageBps ?? 50n),
      args.recipient,
      args.deadline ?? defaultDeadline(),
    ],
    account: args.recipient,
    chain: uni.wallet.chain,
  });
}

/** Free quote for the exact-out direction: fee-inclusive input cost of receiving `amountOut`. */
export async function previewSwapExactOut(
  uni: UnimodClient,
  poolId: Hex,
  assetInIndex: bigint,
  assetOutIndex: bigint,
  amountOut: bigint,
): Promise<bigint> {
  const [, amountIn] = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "previewSwapOut",
    args: [poolId, assetInIndex, assetOutIndex, amountOut],
  });
  return amountIn;
}

export interface SwapExactOutArgs {
  poolId: Hex;
  tokenIn: Address;
  tokenOut: Address;
  assetInIndex: bigint;
  assetOutIndex: bigint;
  amountOut: bigint; // exact amount the recipient receives
  recipient: Address;
  slippageBps?: bigint; // guard on the input side; default 50 = 0.5%
  deadline?: bigint;
}

/** Quote the input cost, derive a max-in ceiling, and submit. Requires `uni.wallet`. */
export async function swapExactOut(uni: UnimodClient, args: SwapExactOutArgs): Promise<Hex> {
  if (!uni.wallet) throw new Error("swapExactOut needs a wallet client");
  const quoted = await previewSwapExactOut(uni, args.poolId, args.assetInIndex, args.assetOutIndex, args.amountOut);
  const maxAmountIn = (quoted * (10_000n + (args.slippageBps ?? 50n))) / 10_000n;

  return uni.wallet.writeContract({
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "swapExactOut",
    args: [
      args.poolId,
      args.tokenIn,
      args.tokenOut,
      args.assetInIndex,
      args.assetOutIndex,
      args.amountOut,
      maxAmountIn,
      args.recipient,
      args.deadline ?? defaultDeadline(),
    ],
    account: args.recipient,
    chain: uni.wallet.chain,
  });
}
