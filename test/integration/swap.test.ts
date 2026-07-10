import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { ensurePermit2Approval, previewSwap, previewSwapExactOut, swapExactIn, swapExactOut } from "../../src/index.js";
import { balanceOf, clientFor, mined, mintTo, poolId, poolTokens } from "../helpers.js";

describe("swap (integration)", () => {
  const me = clientFor("swapper"); // dedicated account — file order is nondeterministic
  const { uni, account } = me;
  const [tokenIn, tokenOut] = [poolTokens[0]!, poolTokens[1]!];

  it("fund the swapper account (test faucet)", async () => {
    for (const t of poolTokens) await mintTo(me, t.address, account, parseUnits("1000", t.decimals));
    expect(await balanceOf(tokenIn.address, account)).toBeGreaterThan(0n);
  });

  it("previewSwapIn equals the executed swap output at the same state", async () => {
    await ensurePermit2Approval(uni, tokenIn.address, account);
    const amountIn = parseUnits("100", tokenIn.decimals);
    const quote = await previewSwap(uni, poolId, 0n, 1n, amountIn);
    expect(quote).toBeGreaterThan(0n);
    const before = await balanceOf(tokenOut.address, account);
    await mined(
      await swapExactIn(uni, {
        poolId,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        assetInIndex: 0n,
        assetOutIndex: 1n,
        amountIn,
        recipient: account,
      }),
    );
    const received = (await balanceOf(tokenOut.address, account)) - before;
    expect(received).toBe(quote);
  });

  it("a round trip loses to fees (no free arbitrage)", async () => {
    await ensurePermit2Approval(uni, tokenOut.address, account);
    const amountIn = parseUnits("50", tokenIn.decimals);
    const startA = await balanceOf(tokenIn.address, account);
    const startB = await balanceOf(tokenOut.address, account);
    await mined(
      await swapExactIn(uni, {
        poolId, tokenIn: tokenIn.address, tokenOut: tokenOut.address, assetInIndex: 0n, assetOutIndex: 1n, amountIn, recipient: account,
      }),
    );
    const gotB = (await balanceOf(tokenOut.address, account)) - startB;
    await mined(
      await swapExactIn(uni, {
        poolId, tokenIn: tokenOut.address, tokenOut: tokenIn.address, assetInIndex: 1n, assetOutIndex: 0n, amountIn: gotB, recipient: account,
      }),
    );
    const endA = await balanceOf(tokenIn.address, account);
    expect(endA).toBeLessThan(startA); // fees + impact make the loop strictly losing
  });
});

describe("swap exact-out (integration)", () => {
  const { uni, account } = clientFor("swapper");
  const [tokenIn, tokenOut] = [poolTokens[0]!, poolTokens[1]!];

  it("previewSwapExactOut equals the executed input paid, output is exact", async () => {
    await ensurePermit2Approval(uni, tokenIn.address, account);
    const amountOut = parseUnits("40", tokenOut.decimals);
    const quote = await previewSwapExactOut(uni, poolId, 0n, 1n, amountOut);
    expect(quote).toBeGreaterThan(0n);
    const inBefore = await balanceOf(tokenIn.address, account);
    const outBefore = await balanceOf(tokenOut.address, account);
    await mined(
      await swapExactOut(uni, {
        poolId,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        assetInIndex: 0n,
        assetOutIndex: 1n,
        amountOut,
        recipient: account,
      }),
    );
    expect(inBefore - (await balanceOf(tokenIn.address, account))).toBe(quote);
    expect((await balanceOf(tokenOut.address, account)) - outBefore).toBe(amountOut);
  });
});
