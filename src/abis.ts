/**
 * abis.ts — the contract ABIs the SDK calls.
 *
 * The protocol ABIs (router / lens / lending / registry) are RE-EXPORTED from `./generated.ts`,
 * which is produced at build time by `npm run codegen` (wagmi) from the pinned `contracts/` checkout.
 * They flow contracts → SDK and never drift. `generated.ts` is gitignored — run `npm run codegen`
 * (or `npm run build`) before typechecking locally, otherwise this import won't resolve.
 *
 * `permit2` and `erc20` are external/standard contracts (not part of Unimod), so they stay as
 * small stable fragments here instead of coming from the protocol codegen.
 */

import { parseAbi } from "viem";

// Protocol ABIs — generated, aliased to the SDK's internal names.
export {
  routerAbi,
  lensAbi,
  unimodLendingAbi as lendingAbi,
  marketRegistryAbi as registryAbi,
} from "./generated.js";

// Standard ERC-20 surface — viem ships a canonical one.
export { erc20Abi } from "viem";

// Permit2 (canonical external contract) — only the AllowanceTransfer bits onboard.ts needs.
export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

// ERC6909 surface on the Unimod core (LP shares) — only what the LP flows need. The core isn't in
// the wagmi codegen include-list (the SDK never calls its pool functions directly; Router does),
// so this stays a stable hand fragment like permit2.
export const erc6909Abi = parseAbi([
  "function setOperator(address operator, bool approved) returns (bool)",
  "function isOperator(address owner, address operator) view returns (bool)",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
]);
