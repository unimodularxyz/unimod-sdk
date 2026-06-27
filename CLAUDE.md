# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@unimodular/unimod-sdk` — a thin, typed TypeScript SDK over the [Unimod protocol](https://github.com/unimodularxyz/unimod) (an n-asset AMM + oracle-free per-asset lending). It wraps two on-chain surfaces — the **Router** (writes) and the **Lens** (reads) — on top of [viem](https://viem.sh). viem is a **peer dependency**, not bundled.

Status: **skeleton**. Read/write helpers and formatting exist; ABIs are minimal hand-written fragments. No tests or linter are configured yet.

## Commands

```bash
pnpm install
pnpm typecheck   # tsc --noEmit — the only correctness gate that exists today
pnpm build       # tsc → dist/  (ESM + .d.ts + sourcemaps)
pnpm clean       # rm -rf dist
```

There is no test runner or lint step. `pnpm typecheck` (strict mode, `noUncheckedIndexedAccess`) is what catches errors — run it after edits. The README documents `pnpm`; an untracked `package-lock.json` (npm) is not the source of truth.

## Architecture

**The handle pattern.** Everything flows through one object, `UnimodClient` = `{ public: PublicClient; wallet?: WalletClient; addresses }`, built by `createUnimodClient` (`client.ts`). Every helper takes it as the first argument (`uni`). Read helpers need only `public`; write helpers throw if `wallet` is absent. Addresses come from the contracts deploy bundle via `addressesFromDeployments(deployments)`, which maps `contracts.marketRegistry → registry` (note the rename) and otherwise passes through.

**One module per UI flow.** Each source file is the typed implementation of one tab/flow described in the contracts repo's `web3/` docs:

| Module | Surface | Reads/Writes |
|---|---|---|
| `client.ts` | the handle + address mapping | — |
| `pools.ts` | Pools tab: `enumeratePools` (registry), `getPoolView` (lens) | read |
| `swap.ts` | Swap tab: `previewSwap`, `swapExactIn` | read + write |
| `position.ts` | Portfolio tab: `getPositionView`, `getApy` | read |
| `onboard.ts` | one-time setup: `ensurePermit2Approval`, `ensureLendingAuthorization` | write |
| `errors.ts` | `messageForError` — custom-error name → user message | — |
| `units.ts` | formatting (WAD / bps / decimals / health / APY) | — |
| `abis.ts` | the contract ABIs | — |

`index.ts` re-exports everything (`export * from "./x.js"`) plus the raw ABIs for callers who drop down to viem. **Note the `.js` extensions on relative imports** — required by `verbatimModuleSyntax` + ESM even though the files are `.ts`.

## Invariants that are easy to get wrong

These are the rules the wrappers exist to enforce. Preserve them in any change:

- **ABIs flow contracts → SDK, never the reverse.** `abis.ts` ships hand-written `parseAbi` fragments *only as a skeleton stopgap*. Production replaces them wholesale with the codegen'd ABIs from the contracts repo (`yarn abis` → `web3/generated.ts`, published as `@unimodular/contracts`). Never hand-edit an ABI to match SDK code; fix the SDK to match the contract.

- **Four numeric scales, never conflated** (mirrors `web3/units.md`): WAD (`1e18` ratios/prices/fees/health), bps (`10000` = 100%), token-native decimals, and shares. `units.ts` has one converter per scale.

- **Token amounts are token-native decimals — never assume 18.** Read/write helpers that touch per-asset amounts take a `tokenDecimals: number[]` in **pool order** and format each asset with its own decimals. Pool-value and LP-share fields *are* 18-dp.

- **`healthFactor == maxUint256` means NO DEBT.** `formatHealth` returns `null` for it (render "—"/"safe"); otherwise a number where `< 1` is liquidatable. Don't treat the sentinel as a real ratio.

- **Read `*Assets`, not raw `*Shares`,** from a `UserPosition` for anything user-facing.

- **APY is continuous compounding** (`apyFromPerSec` = `expm1(ratePerSec * SECONDS_PER_YEAR)`) to match the contract — not simple `rate * year`.

- **Swaps: re-quote immediately before submitting.** Pool prices drift after every swap, so `swapExactIn` calls `previewSwap` itself and derives the `minAmountOut` floor via `minOut(quoted, slippageBps)` (default 50 bps). Permit2 approval for `tokenIn` is a precondition (`onboard.ts`).

- **Onboarding helpers are idempotent** — they read the current allowance/authorization and skip the tx if it's already set, returning only the hashes actually sent.

## Source of truth for protocol semantics

Protocol concepts, per-flow detail, the full error catalog, and the units rules live in the **contracts repo** under [`web3/`](https://github.com/unimodularxyz/unimod/tree/main/web3) (`ui-flows.md`, `units.md`, `events.md`, `glossary.md`, `examples/`). When a question is about *what the protocol does* rather than *how this SDK is shaped*, that repo is authoritative — the SDK is its typed surface.
