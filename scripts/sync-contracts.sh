#!/usr/bin/env bash
# Fetch the Unimod contracts into a gitignored ./contracts checkout, pinned to the SHA/tag
# in ./contracts.ref. NO git submodule — just a plain clone the SDK owns and refreshes.
#
#   Local dev:  pnpm contracts:sync   (uses your ssh/https git auth)
#   CI:         CONTRACTS_REPO=https://x-access-token:$TOKEN@github.com/unimodularxyz/unimod.git pnpm contracts:sync
#
# The pinned ref is the single source of truth for *which* contract version this SDK build
# embeds. Bump contracts.ref (by hand or via the auto-update workflow) to track a new release.
set -euo pipefail

REPO="${CONTRACTS_REPO:-git@github.com:unimodularxyz/unimod.git}"
REF="${CONTRACTS_REF:-$(tr -d ' \n\r' < contracts.ref)}"
DIR="contracts"

if [ ! -d "$DIR/.git" ]; then
  echo "→ cloning $REPO into $DIR"
  git clone "$REPO" "$DIR"
fi

echo "→ checking out contracts @ $REF"
git -C "$DIR" fetch --tags --force origin
git -C "$DIR" checkout --quiet "$REF"

# Contracts' own libs (forge-std, solady, …) live in nested submodules — init them so
# `forge build` can compile. This is internal to the gitignored checkout; the SDK repo
# itself stays submodule-free.
echo "→ syncing contract libs"
git -C "$DIR" submodule update --init --recursive

echo "✓ contracts @ $(git -C "$DIR" rev-parse --short HEAD)"
