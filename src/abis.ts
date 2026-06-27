/**
 * abis.ts — minimal human-readable ABIs for the surface this SDK calls.
 *
 * ⚠️ These are HAND-WRITTEN FRAGMENTS for the skeleton — only the functions/structs the SDK uses.
 *    In production, replace them with the full codegen'd ABIs from the **contracts repo**:
 *    `unimod` runs `yarn abis` (wagmi) → `web3/generated.ts`. The ABIs flow contracts → SDK,
 *    never the reverse (see the contracts repo's web3/README.md "unimod-sdk" section). Either
 *    publish `@unimodular/contracts` and depend on it, or sync `generated.ts` into `src/`.
 */

import { parseAbi } from "viem";

export const lensAbi = parseAbi([
  "struct PoolSummary { uint8 poolType; uint256 marketId; uint8 assetCount; uint16 concentration; uint32 maxLiquidityRatio; uint128 swapFee; uint128 mintFee; uint128 protocolShare; uint128 totalLpShares; uint256 poolValue; uint256[] prices; uint128[] balances; uint256 currentRatioBps; uint256 maxRatioBps; uint256 utilizationBps; }",
  "struct UserPosition { uint256 collateralLp; uint256 freeLp; uint256 collateralValue; uint256 healthFactor; uint256[] supplyShares; uint256[] supplyAssets; uint256[] borrowShares; uint256[] borrowAssets; uint128[] lltvs; }",
  "function poolSummary(bytes32 poolId) view returns (PoolSummary)",
  "function getUserPosition(bytes32 poolId, address user) view returns (UserPosition)",
  "function previewSwapIn(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint128 amountIn) view returns (uint128 grossAmountOut, uint128 amountOut)",
  "function previewSwapOut(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint128 amountOut) view returns (uint128 grossAmountIn, uint128 amountIn)",
  "function previewMaxBorrow(bytes32 poolId, uint256 assetIndex, address user) view returns (uint256 maxAssets)",
  "function borrowRate(bytes32 poolId, uint256 assetIndex) view returns (uint256 borrowRatePerSec, uint256 supplyRatePerSec, uint256 utilizationWad)",
  "function healthBatch(bytes32 poolId, address[] users) view returns (uint256[])",
]);

export const routerAbi = parseAbi([
  "function swapExactIn(bytes32 poolId, address tokenIn, address tokenOut, uint256 assetInIndex, uint256 assetOutIndex, uint128 amountIn, uint128 minAmountOut, address recipient, uint256 deadline) returns (uint128 amountOut)",
  "function supply(bytes32 poolId, uint256 assetIndex, uint256 assets, address recipient, uint256 deadline) returns (uint256 shares)",
  "function multicall(bytes[] data) returns (bytes[] results)",
]);

export const lendingAbi = parseAbi([
  "function setAuthorization(address authorized, bool newIsAuthorized)",
  "function setAuthorizationWithSig((address authorizer, address authorized, bool isAuthorized, uint256 nonce, uint256 deadline) authorization, bytes signature)",
]);

export const registryAbi = parseAbi(["function listPools(uint256 offset, uint256 limit) view returns (bytes32[])"]);

export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
