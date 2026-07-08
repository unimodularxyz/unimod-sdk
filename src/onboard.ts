/**
 * onboard.ts — the one-time approvals a user needs before transacting via the Router.
 *
 * All helpers are IDEMPOTENT (read current allowance, skip if already set). Covers the Permit2
 * `AllowanceTransfer` path + lending authorization. For the gasless EIP-712 `Authorization` + a
 * multicall onboarding bundle, see the contracts repo's `web3/examples/onboard.ts`.
 */

import type { Address, Hex } from "viem";
import { maxUint160, maxUint48, maxUint256 } from "viem";
import type { UnimodClient } from "./client.js";
import { erc20Abi, erc6909Abi, lendingAbi, permit2Abi } from "./abis.js";

/**
 * Ensure the two-step Permit2 standing approval for one token: `token.approve(permit2)` then
 * `permit2.approve(token, router)`. Returns the tx hashes actually sent (may be empty if already set).
 */
export async function ensurePermit2Approval(uni: UnimodClient, token: Address, owner: Address): Promise<Hex[]> {
  if (!uni.wallet) throw new Error("ensurePermit2Approval needs a wallet client");
  const { permit2, router } = uni.addresses;
  const sent: Hex[] = [];

  // step 1 — token → permit2 (most mainnet/L2 users already have this from Uniswap)
  const erc20Allow = await uni.public.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, permit2] });
  if (erc20Allow < maxUint256 / 2n) {
    sent.push(
      await uni.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [permit2, maxUint256], account: owner, chain: uni.wallet.chain }),
    );
  }

  // step 2 — permit2 → router (skip if a non-trivial, unexpired allowance already exists)
  const [amount, expiration] = await uni.public.readContract({ address: permit2, abi: permit2Abi, functionName: "allowance", args: [owner, token, router] });
  const now = Math.floor(Date.now() / 1000);
  if (amount < maxUint160 / 2n || Number(expiration) < now) {
    sent.push(
      await uni.wallet.writeContract({ address: permit2, abi: permit2Abi, functionName: "approve", args: [token, router, maxUint160, Number(maxUint48)], account: owner, chain: uni.wallet.chain }),
    );
  }
  return sent;
}

/**
 * Ensure the Router is an ERC6909 operator on the Unimod core — required before `removeLiquidity`
 * and `zapOut` (the Router pulls the caller's LP shares). Idempotent; returns [] if already set.
 */
export async function ensureLpOperator(uni: UnimodClient, owner: Address): Promise<Hex[]> {
  if (!uni.wallet) throw new Error("ensureLpOperator needs a wallet client");
  const { unimod, router } = uni.addresses;
  const isOp = await uni.public.readContract({ address: unimod, abi: erc6909Abi, functionName: "isOperator", args: [owner, router] });
  if (isOp) return [];
  return [
    await uni.wallet.writeContract({ address: unimod, abi: erc6909Abi, functionName: "setOperator", args: [router, true], account: owner, chain: uni.wallet.chain }),
  ];
}

/**
 * Authorize the Router to act on the user's behalf on the lending side (gas path).
 * Idempotent like the other helpers; returns [] if already authorized.
 */
export async function ensureLendingAuthorization(uni: UnimodClient, owner: Address): Promise<Hex[]> {
  if (!uni.wallet) throw new Error("ensureLendingAuthorization needs a wallet client");
  const authorized = await uni.public.readContract({
    address: uni.addresses.lending,
    abi: lendingAbi,
    functionName: "isAuthorized",
    args: [owner, uni.addresses.router],
  });
  if (authorized) return [];
  return [
    await uni.wallet.writeContract({
      address: uni.addresses.lending,
      abi: lendingAbi,
      functionName: "setAuthorization",
      args: [uni.addresses.router, true],
      account: owner,
      chain: uni.wallet.chain,
    }),
  ];
}
