import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  addLiquidity,
  ensureLpOperator,
  ensurePermit2Approval,
  getFreeLp,
  previewRemoveLiquidity,
  previewZapIn,
  previewZapOut,
  removeLiquidity,
  zapIn,
  zapOut,
} from "../../src/index.js";
import { balanceOf, clientFor, deployments, mined, mintTo, poolId, poolTokens } from "../helpers.js";

describe("liquidity (integration)", () => {
  const me = clientFor("lp"); // dedicated account — file order is nondeterministic
  const { uni, account } = me;
  const asset = poolTokens[0]!;

  it("fund + onboard the LP account", async () => {
    for (const t of poolTokens) await mintTo(me, t.address, account, parseUnits("1000", t.decimals));
    await ensureLpOperator(uni, account); // burn paths pull the caller's LP over ERC6909
    expect(await balanceOf(asset.address, account)).toBeGreaterThan(0n);
  });

  it("zapIn: preview equals the exact input charged, LP delta equals the target", async () => {
    await ensurePermit2Approval(uni, asset.address, account);
    const lpSharesOut = parseUnits("50", 18);
    const quote = await previewZapIn(uni, poolId, 0n, lpSharesOut);
    expect(quote).toBeGreaterThan(0n);
    const tokenBefore = await balanceOf(asset.address, account);
    const lpBefore = await getFreeLp(uni, poolId, account);
    await mined(await zapIn(uni, { poolId, assetIndex: 0n, lpSharesOut, recipient: account }));
    expect(tokenBefore - (await balanceOf(asset.address, account))).toBe(quote);
    expect((await getFreeLp(uni, poolId, account)) - lpBefore).toBe(lpSharesOut);
  });

  it("zapOut: preview equals the exact output received", async () => {
    const lpSharesIn = parseUnits("25", 18);
    const quote = await previewZapOut(uni, poolId, 0n, lpSharesIn);
    expect(quote).toBeGreaterThan(0n);
    const tokenBefore = await balanceOf(asset.address, account);
    await mined(await zapOut(uni, { poolId, assetIndex: 0n, lpSharesIn, recipient: account }));
    expect((await balanceOf(asset.address, account)) - tokenBefore).toBe(quote);
  });

  it("zap round trip loses to fees (swap/2 + mint policy)", async () => {
    const lpSharesOut = parseUnits("10", 18);
    const inCost = await previewZapIn(uni, poolId, 0n, lpSharesOut);
    const outValue = await previewZapOut(uni, poolId, 0n, lpSharesOut);
    expect(outValue).toBeLessThan(inCost);
  });

  it("removeLiquidity: proportional burn pays out exactly previewRemoveLiquidity", async () => {
    // Mint a known LP position first, then burn half of it.
    for (const t of poolTokens) await ensurePermit2Approval(uni, t.address, account);
    await mined(
      await addLiquidity(uni, {
        poolId,
        tokens: poolTokens.map((t) => t.address),
        maxAmounts: poolTokens.map((t) => parseUnits("100", t.decimals)),
        recipient: account,
      }),
    );
    const half = (await getFreeLp(uni, poolId, account)) / 2n;
    const expected = await previewRemoveLiquidity(uni, poolId, half);
    const before = await Promise.all(poolTokens.map((t) => balanceOf(t.address, account)));
    await mined(await removeLiquidity(uni, { poolId, tokens: poolTokens.map((t) => t.address), lpShares: half, recipient: account }));
    const after = await Promise.all(poolTokens.map((t) => balanceOf(t.address, account)));
    for (let i = 0; i < poolTokens.length; i++) expect(after[i]! - before[i]!).toBe(expected[i]!);
  });

  it("zaps revert on Delta pools (pairwise pricing has no single-asset primitive)", async () => {
    const delta = deployments.pools.delta3 ?? deployments.pools.delta;
    if (!delta) return;
    await expect(previewZapIn(uni, delta.poolId as `0x${string}`, 0n, parseUnits("1", 18))).rejects.toThrow();
  });
});
