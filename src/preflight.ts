/**
 * preflight.ts — client-side validation BEFORE signing. Every revert a user can cause by
 * ordinary clicking should be catchable here with a sentence, not a 4-byte selector.
 * All checks are advisory reads; passing preflight does not guarantee inclusion-time success
 * (state can move), but failing it guarantees the tx would revert as-is.
 */

import type { Address, Hex } from "viem";
import { erc20Abi, erc6909Abi, lendingAbi } from "./abis.js";
import type { UnimodClient } from "./client.js";
import { lpShareId } from "./liquidity.js";
import { getMarketState, previewMaxBorrow } from "./lending.js";

export interface Preflight {
  ok: boolean;
  reason?: string; // user-facing sentence when !ok
}

const pass: Preflight = { ok: true };
const fail = (reason: string): Preflight => ({ ok: false, reason });

/** Live debt in asset units (interest accrued to now). */
export async function getDebt(uni: UnimodClient, poolId: Hex, assetIndex: bigint, user: Address): Promise<bigint> {
  return uni.public.readContract({
    address: uni.addresses.lending,
    abi: lendingAbi,
    functionName: "getBorrowAssets",
    args: [poolId, assetIndex, user],
  });
}

/** Free (wallet) LP shares on a pool — exact ERC6909 balance, 18-dp. */
export async function getFreeLp(uni: UnimodClient, poolId: Hex, user: Address): Promise<bigint> {
  return uni.public.readContract({
    address: uni.addresses.unimod,
    abi: erc6909Abi,
    functionName: "balanceOf",
    args: [user, lpShareId(poolId)],
  });
}

/** Repay: needs existing debt on THIS market, wallet balance to cover, and amount < live debt (or use repayMax). */
export async function preflightRepay(
  uni: UnimodClient,
  args: { poolId: Hex; assetIndex: bigint; token: Address; account: Address; amount?: bigint },
): Promise<Preflight> {
  const debt = await getDebt(uni, args.poolId, args.assetIndex, args.account);
  if (debt === 0n) return fail("No debt on this market — select the market where your debt is.");

  const needed = args.amount ?? (debt * 101n) / 100n; // repayMax cap: debt + 1% accrual buffer
  const balance = await uni.public.readContract({ address: args.token, abi: erc20Abi, functionName: "balanceOf", args: [args.account] });
  if (balance < needed) return fail("Wallet balance can't cover this repay — swap into the debt asset first.");

  if (args.amount !== undefined && args.amount >= debt) {
    return fail("Debt grows every block — repay strictly less, or use repayMax for full repayment.");
  }
  return pass;
}

/** Borrow: needs collateral-backed headroom on THIS asset and market liquidity. */
export async function preflightBorrow(
  uni: UnimodClient,
  args: { poolId: Hex; assetIndex: bigint; account: Address; amount: bigint },
): Promise<Preflight> {
  const max = await previewMaxBorrow(uni, args.poolId, args.assetIndex, args.account);
  if (max === 0n) return fail("No borrowing headroom on this market — post collateral on this pool first.");
  if (args.amount > max) return fail("Amount exceeds your max borrow for this asset.");
  const market = await getMarketState(uni, args.poolId, args.assetIndex);
  if (args.amount > market.availableLiquidity) return fail("Not enough liquidity in this market right now.");
  return pass;
}

/** Deposit collateral: needs free LP on THIS pool (LP is per-pool). */
export async function preflightDepositCollateral(
  uni: UnimodClient,
  args: { poolId: Hex; account: Address; lpShares: bigint },
): Promise<Preflight> {
  const free = await getFreeLp(uni, args.poolId, args.account);
  if (free === 0n) return fail("No free LP on this pool — mint LP here first (LP is per-pool).");
  if (args.lpShares > free) return fail("Amount exceeds your free LP on this pool.");
  return pass;
}
