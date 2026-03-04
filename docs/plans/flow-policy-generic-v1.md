# Feature Plan

## Summary
Flow Policy Generic v1 introduces contract-level flow requirements so Surfaces can evaluate graph-shaped user journeys, not only page/component-level structure. The increment adds additive schema/types/validator support for per-surface flow policies and requirement sets (`flowId`, step constraints, transition constraints, terminal constraints). `interfacectl` consumes explicit per-surface flow descriptor artifacts and enforces the same semantics at `Generation time` and `CI/CD time` with policy-driven severity (`off|warn|strict`).

## Strategy alignment
This work strengthens the decision filter by extending deterministic allow/block behavior to higher-order flow decisions that agents frequently generate. It removes an enforcement gap where flow intent existed only in prompts or documentation and converts it into contract-backed checks with machine-readable findings and lifecycle-consistent handling.

Decision filter sentence
"When an agent proposes a change to the user experience, Surfaces determines whether that change is allowed, under what conditions it may proceed, and blocks or corrects it if it violates intent."

## Contract impact
1. Contract definition
- Add optional `surfaces[].flows` with:
  - `policy`: `off|warn|strict`
  - `requirements[]`: `{ flowId, minSteps?, requiredSteps?, requiredTransitions?, terminalSteps? }`
- Add flow descriptor shape consumed by validators:
  - `flows[]`: `{ flowId, steps[{id}], transitions[{from,to}], source? }`
- No breaking changes to existing contracts; `flows` is optional.

2. Enforcement timing
- `Generation time`: `check-generation-boundaries` evaluates flow policy from descriptor payloads.
- `CI/CD time`: `interfacectl validate` loads flow descriptor artifacts and applies flow checks during compliance evaluation.
- `Runtime (edge)`: out of scope in this repo; handled by consuming surfaces, but compile output carries flow policy for runtime consumers.

3. Violation handling
- `off`: flow checks skipped.
- `warn`: flow findings emitted as warnings, non-blocking.
- `strict`: flow findings emitted as errors, blocking.
- Malformed flow descriptor artifact is treated as `E0` artifact invalid.

## Surface impact
- `interfacectl`: primary implementation surface; schema, validator, CLI ingestion, generation guard, compile output, tests.
- `surfaceops.ai`: indirectly benefits through richer finding taxonomy consumed from run artifacts.
- `surfaces.systems`: indirectly benefits when runtime consumers load compile/runtime manifest flow policy.

## Non-goals
- No scenario-specific scaffolds (checkout/onboarding templates) in this increment.
- No automatic flow extraction from source code or AST-based graph inference.
- No ownership workflow, assignment, or post-hoc observability-only UI work.

## Acceptance criteria
1. Contracts without `flows` remain schema-valid and behaviorally unchanged.
2. Contracts with valid `surfaces[].flows` pass schema validation.
3. Invalid flow schema (for example `minSteps: 0`) fails schema validation with actionable errors.
4. Validator emits all six flow violation types when conditions are met.
5. `validate` maps flow violations to finding codes:
   - `descriptor.flows.missing`
   - `flow.required.missing`
   - `flow.steps.min`
   - `flow.steps.required`
   - `flow.transition.required`
   - `flow.terminal.invalid`
6. `validate` returns warning severity for flow findings under warn policy and error severity under strict policy.
7. Missing flow descriptor artifact produces policy-based flow findings (not `E0`).
8. Malformed flow descriptor artifact fails as `E0`.
9. Generation guard JSON includes `evaluation.flowPolicyEvaluated` and flow findings; text mode remains backward-compatible.
10. Compile output includes `surfaces/<id>.json.flows` when configured.

## Risks and drift checks
1. Risk: drifting into prompt-level guidance instead of enforcement.
- Mitigation: all flow behavior is contract-schema backed and evaluated by validator/guard only.

2. Risk: introducing observability-only signals with no gate behavior.
- Mitigation: preserve policy severity mapping so strict remains blocking in both generation guard and validate.

3. Risk: hidden dependency on extraction or app runtime.
- Mitigation: require explicit flow descriptor artifacts in CI path; no runtime app execution.

## Implementation outline
1. Add `flows` schema definitions and type interfaces.
2. Add validator flow compliance checks and new drift violation taxonomy.
3. Add flow descriptor artifact loading to `validate` and `describe` with fallback path support.
4. Map flow violations to stable finding codes and severity behavior.
5. Extend generation guard JSON flow checks and coverage metadata.
6. Update compile output to include surface flow policy data.
7. Add/extend unit and integration tests across validator, CLI, and guard.
8. Document contract/flow semantics in strategy-adjacent docs.
