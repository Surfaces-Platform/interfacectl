# PR Description: Phase 2 Traceability and Output Stability

Use this content when opening the PR. Reference: docs/plans/phase-2-traceability-output-stability.md.

---

## Title

feat: Phase 2 traceability and output stability for diff and enforce

---

## Strategy check

- [x] I read "docs/strategy.md"
- [x] This PR strengthens the decision filter sentence (by making diff/enforce outputs machine-correlatable)
- [x] Enforcement timing is explicit: generation time (unchanged)
- [x] Violation handling is defined: unchanged (blocked via non-zero exit codes)
- [x] CLI behavior is tied to contract semantics, not free-form heuristics

## What changed

- **Diff JSON:** Every entry now includes `stableId`, `contractRef` (path, surfaceId, sectionId, constraintId when derivable), and `ruleRef` (id). Added shared `computeStableId` helper with normalized inputs for cross-OS determinism.
- **Enforce JSON:** Applied and skipped fix entries now include `stableId`, `contractRef`, and `ruleRef` when deterministically derivable.
- **Validator:** New optional types `ContractRef`, `RuleRef`; extended `DiffEntry`, `FixEntry`, `FixError` with traceability fields. Output schemas updated to allow new optional properties.
- **Tests:** New `traceability.test.mjs` verifies output shape, stableId presence, contractRef/ruleRef, and stableId determinism across runs. New `traceability` fixture for diff/enforce integration.
- **API.md:** Documented new fields for diff entries and enforce applied/skipped/errors.

## Why it matters

Downstream tools can correlate diff entries and enforce findings across runs. stableId enables deduplication and change tracking. contractRef and ruleRef support debugging and mapping back to contract structure.

## Contract and enforcement notes

1. No contract schema changes. Output schemas (diff, fix-summary) extended with optional properties only.
2. Enforcement point: unchanged (generation time).
3. Expected behavior on violation: unchanged (non-zero exit codes).

## Phase 2 Acceptance Criteria (from docs/plans/phase-2-traceability-output-stability.md)

1. ✅ `diff --format json` emits `stableId` for every entry.
2. ✅ `diff` entries include `contractRef.path` for all cases where a contract node is unambiguous.
3. ✅ `enforce --format json` emits `stableId` for applied and skipped actions.
4. ✅ `enforce` output includes `contractRef` and `ruleRef` when deterministically derivable.
5. ✅ No changes to validate compliance semantics.
6. ✅ No schema changes (contract schema unchanged; output schemas extended with optional fields only).
7. ✅ A fixture test verifies stable output shape and stableId determinism for diff and enforce.

## Tests

- `test/traceability.test.mjs`: 6 tests for diff/enforce output shape, stableId, contractRef, ruleRef, determinism.
- `test/fixtures/traceability/`: New fixture with contract that produces diffs; policy that produces applied fixes.
- `test/fixtures/examples/diff.json`: Updated with traceability fields.
- `ensureRelativePaths` fix: observed.root no longer empty when workspace equals observed root (schema minLength).

## Phase 2 Pre-Merge Verification (completed)

1. **contractRef overclaim fix:** deriveContractRef omits ref.path when entry.rule === "contract.surface-missing". Keeps ref.surfaceId. Added comment acknowledging narrow guard.
2. **stableId semantics:** JSDoc in stable-id.ts and consolidated API.md section state correlation-id scope, 64-bit, not globally unique.
3. **API.md consolidation:** Single "Traceability fields (Phase 2)" section; diff and enforce reference with "Includes traceability fields." Backwards compatibility note added.
4. **Regression test:** Unit test asserts surface-missing entry has contractRef.surfaceId but omits contractRef.path.

## Phase 2 Review Checklist

- [x] PR stays in scope (diff/enforce output only; no compile, explain, gate, schema changes to contract).
- [x] New output fields documented in API.md.
- [x] Tests prove determinism and shape.
- [x] Output remains readable and not bloated.
