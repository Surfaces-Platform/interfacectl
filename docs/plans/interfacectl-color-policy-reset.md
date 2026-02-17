# Interfacectl Color Policy Reset

## Summary
This feature hard-replaces the split color model with one user-facing allowlist model in `interfacectl`. Contract color policy will use a single `color.policy` and `color.allowedValues` shape for both token variables and raw color literals. The same normalization path will be reused for extraction seeding and validation so `Generation time` and `CI/CD time` use coherent exact-match semantics. Compatibility with legacy color fields is intentionally removed in active code paths.

## Strategy alignment
This work strengthens the decision filter by making color intent executable through one explicit contract field and one enforcement outcome. It removes ambiguous split semantics that made it unclear what was allowed and under what conditions, and it ensures violations are consistently surfaced and gated.

Decision filter sentence
"When an agent proposes a change to the user experience, Surfaces determines whether that change is allowed, under what conditions it may proceed, and blocks or corrects it if it violates intent."

## Contract impact
1. Contract definition
Replace split color fields (`color.sourceOfTruth`, `color.rawValues`) and legacy `surfaces[*].allowedColors` with `color: { policy, allowedValues }`. Invariant: all observed colors are checked against one normalized exact-value allowlist.

2. Enforcement timing
Applies at `Generation time` and `CI/CD time`.
- `Generation time`: extraction/bootstrap emits and seeds the unified color shape.
- `CI/CD time`: `validate`, `diff`, `normalize`, and `compile` consume only unified color policy fields.

3. Violation handling
- `off`: no color violations emitted.
- `warn`: non-allowlisted values are signaled as warning findings.
- `strict`: non-allowlisted values are blocked as error findings.
- Unified violation identity: `color-not-allowed` (`color.disallowed` user-facing concept).

## Surface impact
This affects `interfacectl` only. No runtime enforcement implementation changes are included for other repos in this pass.

## Non-goals
1. No backward compatibility mode for legacy color fields.
2. No `surfaces-webapps` runtime contract-consumer implementation changes.
3. No expansion to regex/prefix matching semantics.
4. No changes to non-color contract domains.

## Acceptance criteria
1. Active `interfacectl` source does not reference `color.sourceOfTruth`, `color.rawValues`, or `surfaces[*].allowedColors`.
2. Schema and types accept only `color.policy + color.allowedValues` for color policy.
3. Extraction-generated contracts are valid without manual edits and local extraction auto-seeds observed colors.
4. Validation emits one coherent color violation type for disallowed values with deterministic details payload.
5. Diff compares descriptor colors against `contract.color.allowedValues`.
6. Normalize treats `color.allowedValues` as deterministic set-like content.
7. Compile outputs include unified color policy and no legacy per-surface allowlist fields.
8. CLI validate output no longer emits deprecated-field color findings tied to `allowedColors`.
9. Migration command converts legacy contracts and is idempotent.
10. Validator, extractor, and CLI package tests pass.

## Risks and drift checks
1. Risk: extraction and validator normalization diverge.
Mitigation: centralize color normalization and import the same function in both paths.

2. Risk: hard break causes broad fixture churn and unstable tests.
Mitigation: add migrator command and update all first-party fixtures/contracts in the same change set.

3. Risk: work drifts into runtime implementation changes outside scope.
Mitigation: keep all code changes inside `interfacectl` and document downstream runtime follow-up explicitly.

## Implementation outline
1. Replace schema/types with unified `color.policy + color.allowedValues`.
2. Simplify validator color checks to one allowlist path with policy-driven severity.
3. Update CLI validate/classifier mappings for unified color findings.
4. Update diff/normalize/compile to consume unified fields only.
5. Add shared extraction seeding utility and wire local extraction flows.
6. Add migrator command and register it in CLI entrypoint.
7. Rewrite affected fixtures/tests/docs for the new contract shape.
8. Rebuild package `dist` artifacts and run package test suites.
