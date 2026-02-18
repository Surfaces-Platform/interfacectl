# Feature Plan

## Summary
Add optional `containerMinWidthPx` support to `surfaces[*].layout.pageFrame` in the web surface contract. The validator and static descriptor extraction paths now enforce this value at CI/CD time when present, using deterministic exact px matching. Selector scope remains fixed to `[data-contract="page-container"]`, and existing contracts that omit the new field keep current behavior.

## Strategy alignment
This work strengthens the decision filter by adding one more explicit, contract-defined layout invariant that can block drift before ship in CI/CD pipelines. It keeps enforcement deterministic and contract-first, avoiding runtime-only or observability-only behavior.

Decision filter sentence
"When an agent proposes a change to the user experience, Surfaces determines whether that change is allowed, under what conditions it may proceed, and blocks or corrects it if it violates intent."

## Contract impact
1. Contract definition
Adds optional `layout.pageFrame.containerMinWidthPx` (`number`, minimum `0`) with exact px semantics.

2. Enforcement timing
CI/CD time only. Enforced via existing `interfacectl validate` static descriptor extraction + contract compliance evaluation.

3. Violation handling
In strict mode, violations fail validation. New deterministic mismatch violation: `layout-pageframe-minwidth-mismatch` (`layout.pageframe.minwidth-mismatch`). Non-deterministic and unextractable min-width values reuse existing pageFrame violation types with `property: "min-width"` details.

## Surface impact
Which surface this affects and why.
- surfaces.systems: indirect, when it consumes updated interfacectl validation behavior.
- surfaceops.ai: indirect, same contract/validation pipeline inputs.
- interfacectl: direct, schema/types/extractor/validator/CLI/tests/docs.

## Non-goals
List what this explicitly does not do to avoid scope drift.
- No selector-scope expansion beyond `[data-contract="page-container"]`.
- No runtime (edge) or generation-time enforcement changes.
- No lower-bound inequality semantics (`>=`); exact px matching only.

## Acceptance criteria
Write 5 to 10 testable criteria.
1. Schema accepts contracts that include `containerMinWidthPx`.
2. Existing contracts without `containerMinWidthPx` continue to validate as before.
3. Matching min-width values produce no pageFrame violations.
4. Mismatched min-width values emit `layout.pageframe.minwidth-mismatch`.
5. `min-width: clamp(...)` emits `layout.pageframe.non-deterministic-value` with min-width context.
6. Unsupported selectors (for example `.shell`) emit `layout.pageframe.selector-unsupported`.
7. Existing pageFrame max-width/padding tests remain green.
8. `pnpm --filter @surfaces/interfacectl-validator run test` passes.
9. `pnpm --filter @surfaces/interfacectl-cli run test` passes.

## Risks and drift checks
List the top 3 ways this could drift into observability-only, design tooling, prompt tooling, or orchestration.
Add one mitigation per risk.
1. Risk: parser/extractor ambiguity from broader selector behavior.
Mitigation: keep selector support fixed to `[data-contract="page-container"]`.
2. Risk: non-deterministic style expressions reduce enforceability.
Mitigation: keep deterministic px extraction requirements and explicit non-deterministic findings.
3. Risk: scope drift into runtime enforcement behavior.
Mitigation: confine changes to validator + static descriptor extraction at CI/CD time.

## Implementation outline
List the smallest steps that can ship value.
1. Extend pageFrame schema/types with optional `containerMinWidthPx`.
2. Extend static extraction for `min-width` (inline styles, CSS selector rules, Tailwind bracket classes, CSS variable fallback).
3. Enforce optional min-width in validator with exact px matching.
4. Add dedicated min-width mismatch violation type and CLI finding mapping.
5. Add min-width fixtures/tests and selector-unsupported regression test.
6. Update pageFrame and baseline docs.
7. Rebuild dist artifacts and run validator/CLI test suites.
