/**
 * lending.ts — the Lending surface: supply/withdraw, LP collateral, borrow/repay.
 *
 * Assets-mode entry points only (token-native decimals); LP shares are 18-dp. Preconditions:
 * supply/repay pull ERC20s via Permit2 (`ensurePermit2Approval`); depositCollateral pulls the
 * ERC6909 LP via the Router (`ensureLpOperator`); supply/withdraw/borrow/repay ALL act `onBehalf`
 * (supply included — lending gates it), so the Router must be authorized once on the lending
 * side (`ensureLendingAuthorization`).
 */

import type { Address, Hex } from "viem";
import { writePadded, type UnimodClient } from "./client.js";
import { lendingAbi, lensAbi, routerAbi } from "./abis.js";
import { deadline as defaultDeadline, formatHealth } from "./units.js";

export interface LendingAmountArgs {
  poolId: Hex;
  assetIndex: bigint;
  assets: bigint; // token-native decimals
  account: Address; // acts as onBehalf/recipient/receiver — the connected user
  deadline?: bigint;
}

/** Supply `assets` to the market; interest accrues to `account`'s supply shares. */
export async function supply(uni: UnimodClient, args: LendingAmountArgs): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "supply",
    args: [args.poolId, args.assetIndex, args.assets, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Withdraw an exact asset amount from the market back to `account`. */
export async function withdraw(uni: UnimodClient, args: LendingAmountArgs): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "withdraw",
    args: [args.poolId, args.assetIndex, args.assets, args.account, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Withdraw the full supply position (exact-shares path — no dust). */
export async function withdrawMax(
  uni: UnimodClient,
  args: Omit<LendingAmountArgs, "assets">,
): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "withdrawMax",
    args: [args.poolId, args.assetIndex, args.account, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

export interface CollateralArgs {
  poolId: Hex;
  lpShares: bigint; // 18-dp
  account: Address;
  deadline?: bigint;
}

/** Post free LP shares as collateral. Precondition: `ensureLpOperator`. */
export async function depositCollateral(uni: UnimodClient, args: CollateralArgs): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "depositCollateral",
    args: [args.poolId, args.lpShares, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Release collateral back to free LP (health-checked on-chain). */
export async function withdrawCollateral(uni: UnimodClient, args: CollateralArgs): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "withdrawCollateral",
    args: [args.poolId, args.lpShares, args.account, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Release as much collateral as health allows. */
export async function withdrawCollateralMax(uni: UnimodClient, args: Omit<CollateralArgs, "lpShares">): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "withdrawCollateralMax",
    args: [args.poolId, args.account, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Borrow against posted LP collateral (borrow-LTV enforced on-chain). Precondition: `ensureLendingAuthorization`. */
export async function borrow(uni: UnimodClient, args: LendingAmountArgs): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "borrow",
    args: [args.poolId, args.assetIndex, args.assets, args.account, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Repay an exact asset amount of `account`'s debt. */
export async function repay(uni: UnimodClient, args: LendingAmountArgs): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "repay",
    args: [args.poolId, args.assetIndex, args.assets, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/**
 * Repay the ENTIRE debt (exact-shares path — no dust). `maxAmount` caps the Permit2 pull and must
 * cover debt + interest accrued up to inclusion; anything unused is refunded by the Router.
 */
export async function repayMax(uni: UnimodClient, args: { poolId: Hex; assetIndex: bigint; maxAmount: bigint; account: Address; deadline?: bigint }): Promise<Hex> {
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "repayMax",
    args: [args.poolId, args.assetIndex, args.maxAmount, args.account, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}

/** Largest additional borrow of `assetIndex` that keeps `user` at health ≥ 1 (0 if at the limit). */
export async function previewMaxBorrow(uni: UnimodClient, poolId: Hex, assetIndex: bigint, user: Address): Promise<bigint> {
  return uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "previewMaxBorrow",
    args: [poolId, assetIndex, user],
  });
}

export interface MarketState {
  totalSupplyAssets: bigint;
  totalBorrowAssets: bigint;
  availableLiquidity: bigint;
  utilization: number; // 0..1, WITH pending interest accrued
}

/** Market-wide totals (interest accrued to now) — what utilization is actually computed from. */
export async function getMarketState(uni: UnimodClient, poolId: Hex, assetIndex: bigint): Promise<MarketState> {
  const m = await uni.public.readContract({
    address: uni.addresses.lending,
    abi: lendingAbi,
    functionName: "previewAccruedMarket",
    args: [poolId, assetIndex],
  });
  const supply = BigInt(m.totalSupplyAssets);
  const borrow = BigInt(m.totalBorrowAssets);
  return {
    totalSupplyAssets: supply,
    totalBorrowAssets: borrow,
    availableLiquidity: supply - borrow,
    utilization: supply === 0n ? 0 : Number(borrow) / Number(supply),
  };
}

/**
 * Health factor the position WOULD have after borrowing `borrowDelta` more of `assetIndex`
 * and changing posted collateral by `collateralDelta` LP (positive = deposit, negative =
 * release). Returns null for "no debt" (the sentinel), else the WAD health as a float —
 * < 1 means the resulting position would be liquidatable.
 */
export async function previewHealthAfter(
  uni: UnimodClient,
  args: { poolId: Hex; user: Address; assetIndex: bigint; borrowDelta?: bigint; collateralDelta?: bigint },
): Promise<number | null> {
  const h = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "previewHealthAfter",
    args: [args.poolId, args.user, args.assetIndex, args.borrowDelta ?? 0n, args.collateralDelta ?? 0n],
  });
  return formatHealth(h);
}
