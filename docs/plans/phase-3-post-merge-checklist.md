# Phase 3 post-merge checklist

## When you open the PR

- [ ] Use the PR body from `.github/PULL_REQUEST_PHASE3_COMPILE.md` (strategy check, what changed, determinism/schema verification, Phase 3 AC1–AC6, review checklist).
- [ ] Merge only after CI is green.

## After merge

- [ ] Delete the feature branch (e.g. the branch this work is on).
- [ ] Mark Phase 3 complete (in your plan/tracking doc or wherever you track phases).
- [ ] Leave Phase 4 on hold until you’ve decided what “runtime consumption” is for your case:
  - Edge-only loaders
  - Server-side rendering adapters
  - Policy-aware runtime gating

The bundle and docs are ready for whichever of those you choose later; no need to change Phase 3 for that.
