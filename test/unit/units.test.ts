import { describe, expect, it } from "vitest";
import { maxUint256 } from "viem";
import { WAD, apyFromPerSec, bpsToPct, deadline, formatHealth, fromWad, minOut } from "../../src/units.js";

describe("units", () => {
  it("WAD round-trips through fromWad", () => {
    expect(fromWad(WAD)).toBe(1);
    expect(fromWad(WAD / 2n)).toBe(0.5);
    expect(fromWad(0n)).toBe(0);
  });

  it("bpsToPct: 500 bps = 5%", () => {
    expect(bpsToPct(500n)).toBe(5);
    expect(bpsToPct(10_000)).toBe(100);
  });

  it("formatHealth: maxUint256 means no debt (null)", () => {
    expect(formatHealth(maxUint256)).toBeNull();
    expect(formatHealth(WAD)).toBe(1);
  });

  it("deadline is in the future and minutes-scaled", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(deadline()).toBeGreaterThan(now);
    expect(deadline(60) - deadline(0)).toBe(3600n);
  });

  it("minOut applies slippage in bps, rounding down", () => {
    expect(minOut(10_000n, 50n)).toBe(9950n); // 0.5%
    expect(minOut(1n, 1n)).toBe(0n); // rounds down
    expect(minOut(10_000n, 0n)).toBe(10_000n);
  });

  it("apyFromPerSec: zero rate is zero, positive rate compounds above simple", () => {
    expect(apyFromPerSec(0n)).toBe(0);
    const fivePctSimplePerSec = WAD / 20n / 31_536_000n; // ≈5%/year simple
    const apy = apyFromPerSec(fivePctSimplePerSec);
    expect(apy).toBeGreaterThan(0.045);
    expect(apy).toBeLessThan(0.06);
  });
});
