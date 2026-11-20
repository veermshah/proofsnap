#!/usr/bin/env bash
# Run inside a fresh Vercel Sandbox (vercel/sandbox/universal image, 4 vCPUs), then snapshot it.
set -ex
curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y --default-toolchain none
export PATH=$HOME/.elan/bin:$PATH
mkdir -p /vercel/sandbox
cd /vercel/sandbox
lake +leanprover-community/mathlib4:lean-toolchain new checker math
cd checker
lake exe cache get
printf 'import Mathlib\nexample : (2:ℕ) + 2 = 4 := by norm_num\n' > Test.lean
time lake env lean Test.lean
