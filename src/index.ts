/**
 * @unimodular/unimod-sdk — typed, ergonomic client for the Unimod protocol.
 *
 * Quick start:
 *   import { createUnimodClient, addressesFromDeployments, getPoolView } from "@unimodular/unimod-sdk";
 *   const uni = createUnimodClient({ public: publicClient, wallet: walletClient, addresses: addressesFromDeployments(deployments) });
 *   const pool = await getPoolView(uni, poolId, [6, 18]);
 */

export * from "./client.js";
export * from "./units.js";
export * from "./pools.js";
export * from "./swap.js";
export * from "./liquidity.js";
export * from "./position.js";
export * from "./onboard.js";
export * from "./errors.js";

// Raw ABIs, for callers who want to drop down to viem directly.
export { lensAbi, routerAbi, lendingAbi, registryAbi, permit2Abi, erc20Abi, erc6909Abi } from "./abis.js";
