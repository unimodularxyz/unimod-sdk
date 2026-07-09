import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  addLiquidity,
  borrow,
  depositCollateral,
  ensureLendingAuthorization,
  ensureLpOperator,
  ensurePermit2Approval,
  getPositionView,
  preflightRepay,
  previewHealthAfter,
  repayMax,
  supply,
  withdrawCollateralMax,
  withdrawMax,
} from "../../src/index.js";
import { clientFor, mined, poolId, poolTokens } from "../helpers.js";

describe("lending lifecycle (integration)", () => {
  const { uni, account } = clientFor("user");
  const decimals = poolTokens.map((t) => t.decimals);
  const asset = poolTokens[0]!;

  it("supply → LP collateral → borrow → health preview → repayMax → release → withdrawMax", async () => {
    for (const t of poolTokens) await ensurePermit2Approval(uni, t.address, account);
    await ensureLendingAuthorization(uni, account);
    await ensureLpOperator(uni, account);

    // Lender side: seed the market so there is liquidity to borrow.
    await mined(await supply(uni, { poolId, assetIndex: 0n, assets: parseUnits("500", asset.decimals), account }));

    // LP: mint shares, post as collateral.
    await mined(
      await addLiquidity(uni, {
        poolId,
        tokens: poolTokens.map((t) => t.address),
        maxAmounts: poolTokens.map((t) => parseUnits("200", t.decimals)),
        recipient: account,
      }),
    );
    const posAfterMint = await getPositionView(uni, poolId, account, decimals);
    const freeLp = parseUnits(posAfterMint.freeLp, 18);
    expect(freeLp).toBeGreaterThan(0n);
    await mined(await depositCollateral(uni, { poolId, lpShares: freeLp, account }));

    // Borrow against it; the health preview must see a healthy, finite position.
    const borrowAmount = parseUnits("50", asset.decimals);
    const healthPreview = await previewHealthAfter(uni, { poolId, user: account, assetIndex: 0n, borrowDelta: borrowAmount });
    expect(healthPreview).not.toBeNull();
    expect(healthPreview!).toBeGreaterThan(1);
    await mined(await borrow(uni, { poolId, assetIndex: 0n, assets: borrowAmount, account }));
    const posBorrowed = await getPositionView(uni, poolId, account, decimals);
    expect(Number(posBorrowed.perAsset[0]!.borrow)).toBeGreaterThan(0);
    expect(posBorrowed.health).not.toBeNull();
    expect(posBorrowed.health!).toBeGreaterThan(1);

    // Unwind: dust-free max paths all the way down.
    await mined(await repayMax(uni, { poolId, assetIndex: 0n, maxAmount: (borrowAmount * 101n) / 100n, account }));
    const posRepaid = await getPositionView(uni, poolId, account, decimals);
    expect(Number(posRepaid.perAsset[0]!.borrow)).toBe(0);
    await mined(await withdrawCollateralMax(uni, { poolId, account }));
    const posReleased = await getPositionView(uni, poolId, account, decimals);
    expect(Number(posReleased.collateralLp)).toBe(0);
    await mined(await withdrawMax(uni, { poolId, assetIndex: 0n, account }));
  });

  it("preflightRepay rejects repaying where there is no debt", async () => {
    const pf = await preflightRepay(uni, { poolId, assetIndex: 1n, token: poolTokens[1]!.address, account, amount: parseUnits("1", poolTokens[1]!.decimals) });
    expect(pf.ok).toBe(false);
    expect(pf.reason).toBeTruthy();
  });
});
