# PR Description: UI AST V2 Cutover

Use this content when opening the PR. Reference: docs/plans/ui-ast-v2-cutover-rfc.md.

---

## Title

feat: make UI AST the canonical governed UI contract

---

## Strategy check

- [x] I read "docs/strategy.md"
- [x] This PR strengthens the decision filter sentence by moving governed UI review and enforcement to a bounded semantic contract
- [x] Enforcement timing is explicit: generation time plus downstream runtime-consumption preparation
- [x] Violation handling is defined: unsupported or invalid AST input fails closed; legacy contract input is migration-only compatibility
- [x] CLI behavior is tied to governed UI semantics, not free-form UI generation

## What changed

- Added a canonical UI AST schema, types, and validator entrypoints for bounded governed UI semantics.
- Added AST resolution and migration helpers so CLI commands resolve `--ast` first and only fall back to legacy `--contract` input for migration compatibility.
- Added `migrate-ui-ast` to deterministically import legacy `web.surface.contract` files into AST drafts.
- Made `compile`, `prepare-generation`, and `prepare-runtime` AST-first on bundle format `3.0`.
- Canonical bundle artifacts are now `ast/normalized.json`, `surfaces/<surface>/ast.json`, and `surfaces/<surface>/platforms.json`, with `derived/contract.normalized.json` kept only for compatibility.
- Updated tests and compile goldens for AST-first bundle output, including multi-platform projection coverage.
- Added RFC/README framing so UI AST is the lead model and legacy contracts are described as migration-only compatibility.

## Why it matters

This makes the semantic contract explicit and reviewable before rendering. Models, validators, runtime consumers, and downstream repos now meet on one bounded artifact instead of inferring meaning from implementation-shaped input. It also creates a clear migration path off the legacy contract model without pretending both models are long-term co-equals.

## Contract and enforcement notes

1. Canonical contract model changed from legacy `web.surface.contract` input to UI AST v2 input.
2. Enforcement point remains generation time; runtime consumers still consume prepared artifacts derived from the compiled bundle.
3. Legacy contract support is explicitly deprecated and migration-only. Invalid AST or invalid migrated AST output fails closed.

## Not in scope

- No second rollout surface beyond the existing benchmark proof downstream.
- No AST-native local-workbench authoring flow.
- No broad consumer-doc sweep or root-script deprecation cleanup beyond the AST-first framing needed for this cutover.

## Tests

- `packages/interfacectl-validator`: `node --test test/authoring-contract.test.mjs test/ui-ast.test.mjs`
- `packages/interfacectl-cli`: `node --test test/color-deprecation.test.mjs test/compile.test.mjs test/prepare-generation.test.mjs test/prepare-runtime.test.mjs test/generation-adapter.test.mjs test/migrate-ui-ast.test.mjs`

## Review checklist

- [x] UI AST is clearly the canonical contract model in code and docs.
- [x] Legacy `--contract` support is described as migration-only compatibility.
- [x] Bundle `3.0` canonical files are AST-first and compatibility output is explicit.
- [x] Migration command and AST schema coverage are test-backed.
- [x] Scope stays limited to the AST cutover itself, without adding more rollout surfaces.
