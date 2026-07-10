import { describe, expect, it } from "vitest";
import { enumeratePools, getApy, getPoolView } from "../../src/index.js";
import { clientFor, deployments, poolId, poolTokens } from "../helpers.js";

describe("pools & rates (integration)", () => {
  const { uni } = clientFor("user");

  it("enumeratePools surfaces every deployed pool", async () => {
    const ids = (await enumeratePools(uni)).map((p) => p.toLowerCase());
    for (const p of Object.values(deployments.pools)) expect(ids).toContain(p.poolId.toLowerCase());
  });

  it("getPoolView reports the market parameters (LLTV 80%, borrow-LTV 75%)", async () => {
    const view = await getPoolView(uni, poolId, poolTokens.map((t) => t.decimals));
    expect(view.lltvPcts[0]).toBeCloseTo(80, 5);
    expect(view.borrowLtvPcts[0]).toBeCloseTo(75, 5);
    expect(view.lltvPcts.length).toBe(poolTokens.length);
  });

  it("getApy: borrow APY strictly above supply APY on an active market", async () => {
    // Earlier suites (lending/liquidate) left this market with live debt.
    const apy = await getApy(uni, poolId, 0n);
    expect(apy.borrowAPY).toBeGreaterThan(0);
    expect(apy.borrowAPY).toBeGreaterThan(apy.supplyAPY);
    expect(apy.supplyAPY).toBeGreaterThanOrEqual(0);
  });
});
