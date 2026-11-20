# ProofSnap

Snap a photo of a handwritten proof. ProofSnap translates each step into Lean 4, the Lean proof checker verifies every step, and you see exactly where the logic breaks.

## How it works

1. **Read.** A vision model transcribes the theorem and splits the proof into numbered steps, without fixing anything.
2. **Formalize.** The model writes a Lean 4 + Mathlib file where every student step becomes its own `have` claim, marked `-- STEP k`. Each claim must be what the student wrote, so a false or unjustified step fails in Lean.
3. **Check.** Lean runs inside a Vercel Sandbox microVM booted from a snapshot that already has Lean, Mathlib and its build cache. The VM has no network access.
4. **Repair.** Lean errors are mapped back to steps. The model gets up to two passes to fix Lean technicalities (syntax, lemma names) without changing what any step claims.
5. **Explain.** Lean's per-step result is the ground truth. The model explains each failing step in plain math, with a counterexample when there is one. `#print axioms` confirms no `sorry` slipped in.

## Stack

- Next.js (App Router) on Vercel
- AI SDK with Vercel AI Gateway (`anthropic/claude-opus-5.5` by default)
- Vercel Sandbox running Lean 4 + Mathlib

## Environment variables

| Name | Purpose |
| --- | --- |
| `LEAN_SNAPSHOT_ID` | Sandbox snapshot with Lean + Mathlib at `/vercel/sandbox/checker` |
| `PROOFSNAP_MODEL` | Optional. Model used for formalization (default `anthropic/claude-opus-5.5`) |
| `PROOFSNAP_FAST_MODEL` | Optional. Model for reading and explaining |
| `PROOFSNAP_MAX_REPAIRS` | Optional. Repair passes (default 2) |

On Vercel, the AI Gateway and Sandbox authenticate with the deployment's OIDC token, so no API keys are needed.

## Rebuilding the Lean snapshot

See `scripts/build-lean-snapshot.sh`. It installs elan, creates a Mathlib project and downloads the Mathlib cache. Snapshot the sandbox afterwards and set `LEAN_SNAPSHOT_ID`.
