/**
 * position.ts — the Portfolio surface + live APY. Pure reads.
 *
 * `healthFactor == max uint256` means NO DEBT (formatHealth → null). Read `*Assets` (token-native),
 * never the raw `*Shares`.
 */

import type { Address, Hex } from "viem";
import type { UnimodClient } from "./client.js";
import { lensAbi } from "./abis.js";
import { apyFromPerSec, formatAmount, formatHealth, fromWad } from "./units.js";

export interface PositionView {
  collateralLp: string;
  freeLp: string;
  collateralValue: string;
  health: number | null; // null = no debt
  perAsset: { borrow: string; supply: string; lltvPct: number }[];
}

export async function getPositionView(
  uni: UnimodClient,
  poolId: Hex,
  user: Address,
  tokenDecimals: number[],
): Promise<PositionView> {
  const p = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "getUserPosition",
    args: [poolId, user],
  });

  return {
    collateralLp: formatAmount(p.collateralLp, 18),
    freeLp: formatAmount(p.freeLp, 18),
    collateralValue: formatAmount(p.collateralValue, 18),
    health: formatHealth(p.healthFactor),
    perAsset: p.borrowAssets.map((debt, i) => ({
      borrow: formatAmount(debt, tokenDecimals[i] ?? 18),
      supply: formatAmount(p.supplyAssets[i] ?? 0n, tokenDecimals[i] ?? 18),
      lltvPct: fromWad(p.lltvs[i] ?? 0n) * 100,
    })),
  };
}

export interface ApyView {
  borrowAPY: number;
  supplyAPY: number;
  utilizationPct: number;
}

/** Live supply/borrow APY for one market — one `lens.borrowRate` call, exp done here. */
export async function getApy(uni: UnimodClient, poolId: Hex, assetIndex: bigint): Promise<ApyView> {
  const [borrowRatePerSec, supplyRatePerSec, utilizationWad] = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "borrowRate",
    args: [poolId, assetIndex],
  });
  return {
    borrowAPY: apyFromPerSec(borrowRatePerSec),
    supplyAPY: apyFromPerSec(supplyRatePerSec),
    utilizationPct: fromWad(utilizationWad) * 100,
  };
}
