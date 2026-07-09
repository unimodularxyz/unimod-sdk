/**
 * liquidate.ts — the Liquidator surface: position discovery, batch health, flash-liquidation.
 *
 * Discovery: the contracts do not enumerate borrowers on-chain — `findBorrowers` scans `Borrow`
 * event logs (fine on a devnet / short ranges; production keepers should use an indexer) and
 * `healthBatch` prices the list in one call. A position is liquidatable when health < 1.
 *
 * Execution: `liquidate` is Unimod's ZERO-CAPITAL flash-liquidation — the Router seizes the LP,
 * burns it, repays the debt from the borrowed-asset slice, sends the bonus to `profitsTo`, and
 * returns non-borrowed slices in kind to the borrower. No approvals, no upfront funds.
 */

import type { Address, Hex } from "viem";
import { getAbiItem } from "viem";
import { writePadded, type UnimodClient } from "./client.js";
import { lendingAbi, lensAbi, routerAbi } from "./abis.js";
import { deadline as defaultDeadline, formatHealth } from "./units.js";

export interface BorrowerRef {
  poolId: Hex;
  borrower: Address;
}

/** Unique (pool, borrower) pairs that have ever borrowed, from `Borrow` logs. */
export async function findBorrowers(uni: UnimodClient, opts: { fromBlock?: bigint } = {}): Promise<BorrowerRef[]> {
  const logs = await uni.public.getLogs({
    address: uni.addresses.lending,
    event: getAbiItem({ abi: lendingAbi, name: "Borrow" }),
    fromBlock: opts.fromBlock ?? 0n,
    toBlock: "latest",
  });
  const seen = new Map<string, BorrowerRef>();
  for (const log of logs) {
    const poolId = log.args.poolId as Hex | undefined;
    const borrower = log.args.onBehalf as Address | undefined;
    if (!poolId || !borrower) continue;
    seen.set(`${poolId}-${borrower.toLowerCase()}`, { poolId, borrower });
  }
  return [...seen.values()];
}

/** Health factors for a list of borrowers in one pool, one call. `null` = no debt; < 1 = liquidatable. */
export async function healthBatch(uni: UnimodClient, poolId: Hex, users: readonly Address[]): Promise<(number | null)[]> {
  const healths = await uni.public.readContract({
    address: uni.addresses.lens,
    abi: lensAbi,
    functionName: "healthBatch",
    args: [poolId, users as Address[]],
  });
  return healths.map((h) => formatHealth(h));
}

export interface LiquidateArgs {
  poolId: Hex;
  assetIndex: bigint; // which borrowed asset to repay
  borrower: Address;
  /** Pass EXACTLY ONE of seizedLp / repaidShares non-zero — lending derives the other. */
  seizedLp?: bigint;
  repaidShares?: bigint;
  profitsTo: Address; // who pockets the liquidation bonus
  account: Address; // tx sender (needs no capital and no approvals)
  deadline?: bigint;
}

/** Flash-liquidate an unhealthy position. Reverts `HealthyPosition` if health ≥ 1. */
export async function liquidate(uni: UnimodClient, args: LiquidateArgs): Promise<Hex> {
  const seized = args.seizedLp ?? 0n;
  const repaid = args.repaidShares ?? 0n;
  if ((seized === 0n) === (repaid === 0n)) throw new Error("pass exactly one of seizedLp / repaidShares");
  return writePadded(uni, {
    address: uni.addresses.router,
    abi: routerAbi,
    functionName: "liquidate",
    args: [args.poolId, args.assetIndex, args.borrower, seized, repaid, args.profitsTo, args.deadline ?? defaultDeadline()],
    account: args.account,
    chain: uni.wallet?.chain,
  });
}
