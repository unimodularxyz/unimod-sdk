/**
 * units.ts — formatting helpers for the four scales Unimod returns.
 *
 * WAD (1e18 ratios/prices/fees/health) · bps (10000 = 100%) · token-native decimals · shares.
 * Mirrors the contracts repo's web3/units.md — read that for which field is which scale.
 */

import { formatUnits, maxUint256 } from "viem";

export const WAD = 10n ** 18n;
export const SECONDS_PER_YEAR = 31_536_000;

/** WAD bigint → float (loses precision below ~1e-15; fine for display). */
export const fromWad = (x: bigint): number => Number(x) / 1e18;

/** basis points → percent (e.g. 500n → 5). */
export const bpsToPct = (x: bigint | number): number => Number(x) / 100;

/** token-native amount → human string, using that token's decimals (never assume 18). */
export const formatAmount = (amount: bigint, decimals: number): string => formatUnits(amount, decimals);

/**
 * Health factor → display. `type(uint256).max` means NO DEBT — returns null, render "—"/"safe".
 * Otherwise a number where `< 1` is liquidatable.
 */
export const formatHealth = (hf: bigint): number | null => (hf === maxUint256 ? null : fromWad(hf));

/** per-second WAD rate → display APY (continuous compounding, matches the contract). */
export const apyFromPerSec = (ratePerSec: bigint): number => Math.expm1(fromWad(ratePerSec) * SECONDS_PER_YEAR);

/** A `deadline` `now + minutes` seconds (default 20). */
export const deadline = (minutes = 20): bigint => BigInt(Math.floor(Date.now() / 1000) + minutes * 60);

/** Apply a bps slippage tolerance as a min-out floor. */
export const minOut = (quoted: bigint, slippageBps: bigint): bigint => (quoted * (10_000n - slippageBps)) / 10_000n;
