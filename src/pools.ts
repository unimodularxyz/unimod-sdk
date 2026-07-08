/**
 * pools.ts — the Pools (exploration) surface. Pure reads.
 */

import type { Hex } from "viem";
import type { UnimodClient } from "./client.js";
import { lensAbi, registryAbi } from "./abis.js";
import { bpsToPct, formatAmount, fromWad } from "./units.js";

/** A pool detail row, every number display-ready. */
export interface PoolView {
  poolId: Hex;
  type: "Star" | "Delta";
  marketId: bigint;
  concentrationPct: number; // 5 = 5% (tight); low = concentrated
  poolValue: string; // numeraire, 18-dp
  balances: string[]; // per asset, each in its OWN token decimals
  prices: number[]; // WAD → float
  maxLiquidityRatio: number; // pool param: post-swap bound on max/min asset value (e.g. 4 = 4×)
  liquidity: { ratio: number; maxRatio: number; utilizationPct: number; atGuard: boolean };
  fees: { swapPct: number; mintPct: number };
  totalLpShares: string;
}

/** Every pool id (`MarketRegistry.listPools` returns `(marketIds, poolIds)` — we want the ids). */
export async function enumeratePools(uni: UnimodClient, limit = 200n): Promise<readonly Hex[]> {
  const [, poolIds] = await uni.public.readContract({
    address: uni.addresses.registry,
    abi: registryAbi,
    functionName: "listPools",
    args: [0n, limit],
  });
  return poolIds;
}

/**
 * One `poolSummary` call → a formatted PoolView.
 * `tokenDecimals` is this pool's per-asset decimals (pool order) — amounts are token-native, never 18.
 */
export async function getPoolView(uni: UnimodClient, poolId: Hex, tokenDecimals: number[]): Promise<PoolView> {
  const s = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "poolSummary",
    args: [poolId],
  });

  return {
    poolId,
    type: s.poolType === 1 ? "Star" : "Delta", // IPool.PoolType: Delta = 0, Star = 1
    marketId: s.marketId,
    concentrationPct: bpsToPct(s.concentration),
    poolValue: formatAmount(s.poolValue, 18),
    balances: s.balances.map((b, i) => formatAmount(b, tokenDecimals[i] ?? 18)),
    prices: s.prices.map(fromWad),
    maxLiquidityRatio: Number(s.maxLiquidityRatio),
    liquidity: {
      ratio: Number(s.currentRatioBps) / 10_000,
      maxRatio: Number(s.maxRatioBps) / 10_000,
      utilizationPct: bpsToPct(s.utilizationBps),
      atGuard: s.utilizationBps >= 10_000n,
    },
    fees: { swapPct: fromWad(s.swapFee) * 100, mintPct: fromWad(s.mintFee) * 100 },
    totalLpShares: formatAmount(s.totalLpShares, 18),
  };
}
