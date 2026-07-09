/**
 * errors.ts — map Unimod custom-error names to user-facing messages.
 *
 * Use with viem's `BaseError.walk` to find the `ContractFunctionRevertedError`, read its
 * `data.errorName`, and look it up here. A representative set — extend from the contracts' errors
 * (see the contracts repo's `web3/examples/errors.ts` for the full catalog).
 */

export const ERROR_MESSAGES: Record<string, string> = {
  // lending
  UnhealthyPosition: "This would leave the position undercollateralized. Borrow less or add collateral.",
  HealthyPosition: "That position is healthy — it can't be liquidated.",
  InconsistentLiquidationArgs: "Pass exactly one of seized-LP or repaid-shares.",
  UnauthorizedCaller: "Authorize the Router for lending first (one-time).",
  InsufficientBalance: "Not enough liquidity in this lending market to borrow that amount.",
  // AMM / flash accounting
  UnhealthyLiquidity: "That trade would push the pool past its liquidity guard. Try a smaller size.",
  ExcessivePriceImpact: "Price impact too large for this pool. Reduce the trade size.",
  CurrencyNotSettled: "Internal settlement error — retry.",
  ManagerLocked: "Call through the Router, not the AMM directly.",
  UnsupportedForDeltaPool: "Single-asset zap isn't available on Delta pools — swap then add liquidity.",
  // router
  DeadlineExceeded: "Transaction took too long and expired. Try again.",
  ArrayLengthMismatch: "Token / amount arrays must be the same length.",
};

/** Look up a friendly message by custom-error name; falls back to the name itself. */
export function messageForError(errorName: string | undefined): string {
  if (!errorName) return "Transaction failed.";
  return ERROR_MESSAGES[errorName] ?? `Transaction reverted (${errorName}).`;
}

/* ── Selector decoding ─────────────────────────────────────────────────────────
 * Errors thrown by inner contracts (lending, AMM core) bubble through the Router,
 * whose ABI viem decodes against — so they surface as bare 4-byte selectors.
 * Map selectors across every protocol ABI back to names + the catalog above.
 */

import { toFunctionSelector, type Abi } from "viem";
import { lendingAbi, lensAbi, registryAbi, routerAbi } from "./abis.js";

const errorBySelector = new Map<string, string>();
for (const abi of [routerAbi, lendingAbi, lensAbi, registryAbi] as readonly Abi[]) {
  for (const item of abi) {
    if (item.type === "error") {
      const sig = `${item.name}(${item.inputs.map((i: { type: string }) => i.type).join(",")})`;
      errorBySelector.set(toFunctionSelector(sig as never).toLowerCase(), item.name);
    }
  }
}

/**
 * Turn any thrown error into a one-line, user-facing message: undecoded custom-error
 * selectors become `Name: friendly message`; everything else keeps its first line.
 */
export function explainError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const selector = message.match(/0x[0-9a-fA-F]{8}(?![0-9a-fA-F])/)?.[0]?.toLowerCase();
  const name = selector ? errorBySelector.get(selector) : undefined;
  if (name) return `${name}: ${messageForError(name)}`;
  return message.split("\n")[0] ?? message;
}
