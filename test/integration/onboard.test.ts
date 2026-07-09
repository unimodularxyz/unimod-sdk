import { describe, expect, it } from "vitest";
import { encodeFunctionData, maxUint160 } from "viem";
import {
  ensureErc20ToPermit2,
  ensureLendingAuthorization,
  ensureLpOperator,
  ensurePermit2Approval,
  multicallRouter,
  routerAbi,
  permit2Abi,
  signPermit2,
} from "../../src/index.js";
import { clientFor, mined, publicClient, tokens } from "../helpers.js";

describe("onboarding (integration)", () => {
  const { uni, account } = clientFor("user");

  it("ensurePermit2Approval sends txs once (fresh wallet), then is a no-op", async () => {
    // Self-contained regardless of file order: a never-onboarded wallet sends on the first call,
    // and for ANY wallet the call after an ensure is always a no-op.
    const fresh = clientFor("fresh");
    const first = await ensurePermit2Approval(fresh.uni, tokens[2]!.address, fresh.account);
    expect(first.length).toBeGreaterThan(0);
    expect(await ensurePermit2Approval(fresh.uni, tokens[2]!.address, fresh.account)).toEqual([]);
    await ensurePermit2Approval(uni, tokens[0]!.address, account);
    expect(await ensurePermit2Approval(uni, tokens[0]!.address, account)).toEqual([]);
  });

  it("ensureLendingAuthorization is idempotent", async () => {
    await ensureLendingAuthorization(uni, account);
    expect(await ensureLendingAuthorization(uni, account)).toEqual([]);
  });

  it("ensureLpOperator is idempotent", async () => {
    await ensureLpOperator(uni, account);
    expect(await ensureLpOperator(uni, account)).toEqual([]);
  });

  it("signPermit2 + Router.applyPermit2 establishes a standing allowance for a fresh wallet", async () => {
    const fresh = clientFor("fresh");
    const token = tokens[1]!.address;
    await ensureErc20ToPermit2(fresh.uni, token, fresh.account); // the one unavoidable ERC20 tx
    const p = await signPermit2(fresh.uni, fresh.account, token); // EIP-712 signature, no gas
    await mined(
      await multicallRouter(fresh.uni, {
        calls: [encodeFunctionData({ abi: routerAbi, functionName: "applyPermit2", args: [fresh.account, p.permitSingle, p.signature] })],
        account: fresh.account,
      }),
    );
    const [amount, expiration] = await publicClient.readContract({
      address: fresh.uni.addresses.permit2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [fresh.account, token, fresh.uni.addresses.router],
    });
    expect(amount).toBeGreaterThanOrEqual(maxUint160 / 2n);
    expect(Number(expiration)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
