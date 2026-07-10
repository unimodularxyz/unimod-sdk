import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  addLiquidity,
  borrow,
  withdrawMax,
  depositCollateral,
  ensureLendingAuthorization,
  ensureLpOperator,
  ensurePermit2Approval,
  findBorrowers,
  getPositionView,
  healthBatch,
  liquidate,
  previewMaxBorrow,
  supply,
} from "../../src/index.js";
import { balanceOf, clientFor, mined, mintTo, poolId, poolTokens, publicClient, warp } from "../helpers.js";

/**
 * Full keeper scenario on the hermetic chain: a borrower maxes out, eight years of interest
 * accrue (anvil time travel — lazy accrual means the debt only materializes on touch, but
 * health READS accrue live), the keeper discovers → prices → flash-liquidates with zero
 * capital and zero approvals.
 */
describe("liquidate (integration)", () => {
  // The 2-year warp would poison wall-clock deadlines for every OTHER suite on the shared
  // chain — bracket this file in an anvil snapshot so its time travel never leaks.
  let snapshot: unknown;
  beforeAll(async () => {
    snapshot = await publicClient.request({ method: "evm_snapshot" as never, params: [] as never });
  });
  afterAll(async () => {
    await publicClient.request({ method: "evm_revert" as never, params: [snapshot] as never });
  });

  const borrower = clientFor("borrower");
  const keeper = clientFor("keeper");
  const decimals = poolTokens.map((t) => t.decimals);
  const asset = poolTokens[0]!;

  it("borrow max → accrue → findBorrowers → healthBatch < 1 → zero-capital liquidate", async () => {
    // Fund + onboard the borrower (mint is the tests' faucet; anvil pre-funds gas).
    for (const t of poolTokens) {
      await mintTo(borrower, t.address, borrower.account, parseUnits("500", t.decimals));
      await ensurePermit2Approval(borrower.uni, t.address, borrower.account);
    }
    await ensureLendingAuthorization(borrower.uni, borrower.account);
    await ensureLpOperator(borrower.uni, borrower.account);

    // Give the market something to lend, post LP collateral, borrow ~all of the max.
    await mined(await supply(borrower.uni, { poolId, assetIndex: 0n, assets: parseUnits("300", asset.decimals), account: borrower.account }));
    await mined(
      await addLiquidity(borrower.uni, {
        poolId,
        tokens: poolTokens.map((t) => t.address),
        maxAmounts: poolTokens.map((t) => parseUnits("150", t.decimals)),
        recipient: borrower.account,
      }),
    );
    const pos0 = await getPositionView(borrower.uni, poolId, borrower.account, decimals);
    await mined(await depositCollateral(borrower.uni, { poolId, lpShares: parseUnits(pos0.freeLp, 18), account: borrower.account }));
    const max = await previewMaxBorrow(borrower.uni, poolId, 0n, borrower.account);
    expect(max).toBeGreaterThan(0n);
    await mined(await borrow(borrower.uni, { poolId, assetIndex: 0n, assets: (max * 99n) / 100n, account: borrower.account }));

    // Crank utilization to ~100%: the deployer (who seeded this market at deploy time) pulls
    // every withdrawable unit, so only the borrower's debt remains against minimal supply.
    const deployer = clientFor("deployer");
    await ensureLendingAuthorization(deployer.uni, deployer.account);
    await mined(await withdrawMax(deployer.uni, { poolId, assetIndex: 0n, account: deployer.account }));

    // Eight years of interest (~2.3%/yr base rate ⇒ ~20% cumulative), far past the 7.7% gap
    // between the borrow buffer and the liquidation line. Accrual is LAZY: the Lens health
    // does NOT accrue in-view (getDebt does — flagged as a Lens gap), so a 1-wei supply
    // "poke" materializes the accrued debt into storage where healthBatch can see it.
    await warp(8 * 365 * 24 * 3600);
    const FAR = BigInt(Math.floor(Date.now() / 1000) + 9 * 365 * 24 * 3600); // chain time is 8y ahead of wall clock
    await mined(await supply(borrower.uni, { poolId, assetIndex: 0n, assets: 1000n, account: borrower.account, deadline: FAR }));

    // Keeper surface: discovery via Borrow logs, live health via the Lens.
    const refs = await findBorrowers(keeper.uni);
    const me = refs.find((r) => r.borrower.toLowerCase() === borrower.account.toLowerCase() && r.poolId.toLowerCase() === poolId.toLowerCase());
    expect(me, "findBorrowers must surface the borrower").toBeTruthy();
    const [health] = await healthBatch(keeper.uni, poolId, [borrower.account]);
    expect(health).not.toBeNull();
    expect(health!).toBeLessThan(1);

    // Zero capital, zero approvals: seize a quarter of the collateral, bonus to the keeper.
    const posBefore = await getPositionView(keeper.uni, poolId, borrower.account, decimals);
    const keeperBefore = await balanceOf(asset.address, keeper.account);
    await mined(
      await liquidate(keeper.uni, {
        poolId,
        assetIndex: 0n,
        borrower: borrower.account,
        seizedLp: parseUnits(posBefore.collateralLp, 18) / 4n,
        profitsTo: keeper.account,
        account: keeper.account,
        deadline: FAR,
      }),
    );
    // Bonus landed (keeper had NOTHING before), debt shrank, collateral shrank.
    expect(await balanceOf(asset.address, keeper.account)).toBeGreaterThan(keeperBefore);
    const posAfter = await getPositionView(keeper.uni, poolId, borrower.account, decimals);
    expect(Number(posAfter.perAsset[0]!.borrow)).toBeLessThan(Number(posBefore.perAsset[0]!.borrow));
    expect(Number(posAfter.collateralLp)).toBeLessThan(Number(posBefore.collateralLp));
  });

  it("liquidate rejects ambiguous args client-side", async () => {
    await expect(
      liquidate(keeper.uni, { poolId, assetIndex: 0n, borrower: borrower.account, profitsTo: keeper.account, account: keeper.account }),
    ).rejects.toThrow(/exactly one/);
  });
});
