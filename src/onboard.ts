/**
 * onboard.ts — the one-time approvals a user needs before transacting via the Router.
 *
 * All helpers are IDEMPOTENT (read current allowance, skip if already set) and WAIT for their
 * transactions to mine before returning — the next call's gas estimate must see the new state.
 * Covers the Permit2 `AllowanceTransfer` path + lending authorization. For the gasless EIP-712 `Authorization` + a
 * multicall onboarding bundle, see the contracts repo's `web3/examples/onboard.ts`.
 */

import type { Address, Hex } from "viem";
import { maxUint160, maxUint48, maxUint256, parseSignature } from "viem";
import { writePadded, type UnimodClient } from "./client.js";
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
      await writePadded(uni, { address: token, abi: erc20Abi, functionName: "approve", args: [permit2, maxUint256], account: owner, chain: uni.wallet.chain }),
    );
  }

  // step 2 — permit2 → router (skip if a non-trivial, unexpired allowance already exists)
  const [amount, expiration] = await uni.public.readContract({ address: permit2, abi: permit2Abi, functionName: "allowance", args: [owner, token, router] });
  const now = Math.floor(Date.now() / 1000);
  if (amount < maxUint160 / 2n || Number(expiration) < now) {
    sent.push(
      await writePadded(uni, { address: permit2, abi: permit2Abi, functionName: "approve", args: [token, router, maxUint160, Number(maxUint48)], account: owner, chain: uni.wallet.chain }),
    );
  }
  return mined(uni, sent);
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
  return mined(uni, [
    await writePadded(uni, { address: unimod, abi: erc6909Abi, functionName: "setOperator", args: [router, true], account: owner, chain: uni.wallet.chain }),
  ]);
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
  return mined(uni, [
    await writePadded(uni, {
      address: uni.addresses.lending,
      abi: lendingAbi,
      functionName: "setAuthorization",
      args: [uni.addresses.router, true],
      account: owner,
      chain: uni.wallet.chain,
    }),
  ]);
}

/** Wait for onboarding txs to mine; throws if any reverted. */
async function mined(uni: UnimodClient, hashes: Hex[]): Promise<Hex[]> {
  for (const hash of hashes) {
    const r = await uni.public.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`onboarding transaction reverted: ${hash}`);
  }
  return hashes;
}

/* ── Signature-based onboarding (single-transaction first actions) ─────────────
 * The signed twins of the tx-based helpers above: a Permit2 AllowanceTransfer permit
 * and the lending Authorization, both EIP-712. Bundle their Router-encoded calls with
 * the first real action via `multicallRouter` — 2 signatures + 1 transaction.
 * The once-per-token `token.approve(permit2)` leg (usually already set on real chains
 * from prior Permit2 usage) is the only part that still needs a transaction:
 * `ensureErc20ToPermit2`.
 */

const PERMIT2_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export interface SignedPermit2 {
  permitSingle: {
    details: { token: Address; amount: bigint; expiration: number; nonce: number };
    spender: Address;
    sigDeadline: bigint;
  };
  signature: Hex;
}

/** Sign an unlimited, non-expiring standing allowance for the Router (EIP-712, no gas). */
export async function signPermit2(uni: UnimodClient, owner: Address, token: Address): Promise<SignedPermit2> {
  if (!uni.wallet) throw new Error("signPermit2 needs a wallet client");
  const [, , nonce] = await uni.public.readContract({
    address: uni.addresses.permit2,
    abi: permit2Abi,
    functionName: "allowance",
    args: [owner, token, uni.addresses.router],
  });
  const permitSingle = {
    details: { token, amount: maxUint160, expiration: Number(maxUint48), nonce: Number(nonce) },
    spender: uni.addresses.router,
    sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
  };
  const signature = await uni.wallet.signTypedData({
    account: owner,
    domain: { name: "Permit2", chainId: uni.wallet.chain!.id, verifyingContract: uni.addresses.permit2 },
    types: PERMIT2_TYPES,
    primaryType: "PermitSingle",
    message: permitSingle,
  });
  return { permitSingle, signature };
}

export interface SignedLendingAuth {
  authorization: { authorizer: Address; authorized: Address; isAuthorized: boolean; nonce: bigint; deadline: bigint };
  signature: { v: number; r: Hex; s: Hex };
}

/** Sign the lending-side Router authorization (EIP-712, no gas). Domain is Morpho-style minimal. */
export async function signLendingAuthorization(uni: UnimodClient, owner: Address): Promise<SignedLendingAuth> {
  if (!uni.wallet) throw new Error("signLendingAuthorization needs a wallet client");
  const nonce = await uni.public.readContract({ address: uni.addresses.lending, abi: lendingAbi, functionName: "nonce", args: [owner] });
  const authorization = {
    authorizer: owner,
    authorized: uni.addresses.router,
    isAuthorized: true,
    nonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60),
  };
  const sig = await uni.wallet.signTypedData({
    account: owner,
    domain: { chainId: uni.wallet.chain!.id, verifyingContract: uni.addresses.lending },
    types: {
      Authorization: [
        { name: "authorizer", type: "address" },
        { name: "authorized", type: "address" },
        { name: "isAuthorized", type: "bool" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Authorization",
    message: authorization,
  });
  const parsed = parseSignature(sig);
  return { authorization, signature: { v: Number(parsed.v ?? (parsed.yParity === 0 ? 27n : 28n)), r: parsed.r, s: parsed.s } };
}

/** The once-per-token ERC20 → Permit2 approval (transaction; usually pre-existing on real chains). */
export async function ensureErc20ToPermit2(uni: UnimodClient, token: Address, owner: Address): Promise<Hex[]> {
  if (!uni.wallet) throw new Error("ensureErc20ToPermit2 needs a wallet client");
  const allow = await uni.public.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, uni.addresses.permit2] });
  if (allow >= maxUint256 / 2n) return [];
  return mined(uni, [
    await writePadded(uni, {
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [uni.addresses.permit2, maxUint256],
      account: owner,
      chain: uni.wallet.chain,
    }),
  ]);
}
