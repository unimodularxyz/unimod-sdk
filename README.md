# @unimodular/unimod-sdk

Typed, ergonomic TypeScript SDK for the [Unimod protocol](https://github.com/unimodularxyz/unimod)
(n-asset AMM + oracle-free per-asset lending). Thin wrappers over the `Router` (writes) and `Lens`
(reads) surface, built on [viem](https://viem.sh).

> **Status: skeleton.** Core read/write helpers + formatting are in place; the ABIs are minimal
> hand-written fragments (see [ABIs](#abis)). Not yet published.

## Install

```bash
pnpm add @unimodular/unimod-sdk viem   # viem is a peer dependency
```

## Quick start

```ts
import { createPublicClient, createWalletClient, http, custom } from "viem";
import { foundry } from "viem/chains";
import {
  createUnimodClient,
  addressesFromDeployments,
  getPoolView,
  swapExactIn,
  getPositionView,
  getApy,
} from "@unimodular/unimod-sdk";
import deployments from "../contracts/deployments/31337.json"; // from the contracts deploy

const uni = createUnimodClient({
  public: createPublicClient({ chain: foundry, transport: http() }),
  wallet: createWalletClient({ chain: foundry, transport: custom(window.ethereum) }),
  addresses: addressesFromDeployments(deployments),
});

const poolId = deployments.pools.star.poolId as `0x${string}`;

// Pools tab — one call, fully formatted
const pool = await getPoolView(uni, poolId, [6, 18]); // token decimals, pool order
// → { concentrationPct: 5, poolValue, liquidity: { utilizationPct, atGuard }, ... }

// Portfolio tab
const pos = await getPositionView(uni, poolId, account, [6, 18]); // pos.health === null ⇒ no debt
const { borrowAPY, supplyAPY } = await getApy(uni, poolId, 1n);

// Swap tab — quote + slippage-guarded submit
const hash = await swapExactIn(uni, {
  poolId, tokenIn, tokenOut, assetInIndex: 0n, assetOutIndex: 1n,
  amountIn: 1_000_000n, recipient: account, slippageBps: 50n,
});
```

## Layout

| Module | Surface |
|---|---|
| `client.ts` | `createUnimodClient`, `addressesFromDeployments` — the handle (addresses + viem clients) |
| `pools.ts` | `enumeratePools`, `getPoolView` — the Pools tab |
| `swap.ts` | `previewSwap`, `swapExactIn` — the Swap tab |
| `position.ts` | `getPositionView`, `getApy` — the Portfolio tab |
| `onboard.ts` | `ensurePermit2Approval`, `ensureLendingAuthorization` — idempotent one-time setup |
| `errors.ts` | `messageForError` — custom-error → user-facing message |
| `units.ts` | formatting (WAD / bps / decimals / health / APY) |
| `abis.ts` | the contract ABIs (see below) |

The protocol concepts, per-flow detail, and the formatting/units rules these wrappers implement live
in the **contracts repo** under [`web3/`](https://github.com/unimodularxyz/unimod/tree/main/web3)
(`ui-flows.md`, `units.md`, `events.md`, `glossary.md`) — the SDK is the typed implementation of that
surface.

## ABIs

The ABIs are **derived from the contracts** and flow contracts → SDK, never the reverse. Today
`src/abis.ts` ships **minimal hand-written fragments** for only the functions the SDK calls — enough
for the skeleton to build and run. Before this is production:

- **Preferred:** the contracts repo publishes its codegen'd ABIs (`web3/generated.ts` from `yarn abis`)
  as `@unimodular/contracts`; this SDK depends on that package and re-exports from it.
- **Interim:** sync `generated.ts` into `src/` (a `sync-abis` script copying from a local contracts
  checkout), or vendor it.

Either way, replace the `parseAbi` fragments in `src/abis.ts` with the generated ABIs — same SHA as the
contracts so the types never drift. See the contracts repo's `web3/README.md` → "unimod-sdk" section
for the rationale.

## Develop

```bash
pnpm install
pnpm typecheck
pnpm build      # tsc → dist/
```
