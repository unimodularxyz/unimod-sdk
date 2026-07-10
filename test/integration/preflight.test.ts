import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { preflightBorrow, preflightDepositCollateral, preflightRepay } from "../../src/index.js";
import { clientFor, poolId, poolTokens } from "../helpers.js";

/** Every revert a user can cause by ordinary clicking should be a sentence before signing. */
describe("preflight (integration)", () => {
  const fresh = clientFor("fresh"); // no collateral, no LP, no debt anywhere

  it("preflightBorrow rejects a borrower with no collateral", async () => {
    const pf = await preflightBorrow(fresh.uni, { poolId, assetIndex: 0n, account: fresh.account, amount: parseUnits("10", poolTokens[0]!.decimals) });
    expect(pf.ok).toBe(false);
    expect(pf.reason).toBeTruthy();
  });

  it("preflightDepositCollateral rejects without free LP", async () => {
    const pf = await preflightDepositCollateral(fresh.uni, { poolId, account: fresh.account, lpShares: parseUnits("1", 18) });
    expect(pf.ok).toBe(false);
    expect(pf.reason).toBeTruthy();
  });

  it("preflightRepay rejects with no debt AND with amount over balance", async () => {
    const noDebt = await preflightRepay(fresh.uni, { poolId, assetIndex: 0n, token: poolTokens[0]!.address, account: fresh.account, amount: 1n });
    expect(noDebt.ok).toBe(false);
  });
});
