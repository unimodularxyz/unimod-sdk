import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

// Codegen for the SDK. Reads the Forge build artifacts from the pinned `contracts/`
// git submodule and emits `src/generated.ts` (gitignored) — the typed ABIs the SDK
// wrappers consume. `pnpm codegen` runs `forge build` in the submodule first.
//
// ABIs flow contracts -> SDK, never the reverse. The submodule SHA is the single
// source of truth for *which* contract version this SDK build embeds.
export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    foundry({
      project: 'contracts',
      // Pick exactly the surfaces the SDK calls — keeps the output small and stable.
      include: [
        'Router.sol/**',
        'Lens.sol/**',
        'UnimodLending.sol/**',
        'MarketRegistry.sol/**',
      ],
    }),
  ],
})
