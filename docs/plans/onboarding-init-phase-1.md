# Feature Plan

## Summary
Add a new `interfacectl init` onboarding command to bootstrap the first surface from either a remote URL or a local app root. The command introduces interactive prompts, optional non-interactive flags, browser-session auth profile capture metadata, and run artifact emission so onboarding contributes to the same run lineage model used by SurfaceOps. This work targets first-run usability without hardcoding any customer surface identifiers.

## Strategy alignment
This work strengthens the enforcement path by turning first extraction into a deterministic `Generation time` flow that produces contract/extraction artifacts and records violation/status signals immediately. It keeps onboarding inside contract-aware tooling and preserves existing `CI/CD time` checks by emitting schema-compatible artifacts consumed by current validation scripts.

Decision filter sentence
"When an agent proposes a change to the user experience, Surfaces determines whether that change is allowed, under what conditions it may proceed, and blocks or corrects it if it violates intent."

## Contract impact
1. Contract definition
No canonical contract schema changes. New onboarding output uses existing generated contract/extraction artifact shapes and existing run artifact schemas (`contract-runs.json`, `contract-lineage.json`).

2. Enforcement timing
- `Generation time`: `interfacectl init` produces the first generated artifacts and onboarding summary.
- `CI/CD time`: Existing `interfacectl validate*` and `validate-run-artifacts` continue to gate outputs without additional schema branching.
- `Runtime (edge)`: no change in this phase.

3. Violation handling
Invalid URL/inputs and unsupported mode combinations are blocked with non-zero exit and explicit errors. Extraction warnings are surfaced as `warn` status in emitted onboarding run entries.

## Surface impact
- `interfacectl`: primary implementation for first-surface onboarding and auth profile lifecycle.
- `surfaceops.ai`: consumes emitted artifacts/run lineage for visibility (no runtime enforcement change in this phase).
- `surfaces.systems`: unchanged contract semantics.

## Non-goals
- Full browser automation or cookie/token persistence.
- Runtime (edge) auth/session enforcement changes.
- Changing canonical contract authoring semantics.

## Acceptance criteria
1. `interfacectl init` exists and supports interactive onboarding prompts.
2. `interfacectl init --non-interactive` works with `--url` and optional `--surface`/`--auth-profile`.
3. `interfacectl init` writes generated contract and extraction report artifacts.
4. Onboarding writes run/lineage artifacts in existing schema with source `bootstrap`.
5. Protected URL path supports browser-session profile capture metadata and reuse checks.
6. `interfacectl auth list`, `interfacectl auth test`, and `interfacectl auth clear` commands are available.
7. No auth tokens/cookies are persisted to run artifacts.
8. Existing CLI tests still pass.

## Risks and drift checks
1. Risk: onboarding becomes observability-only (summary without artifacts).
Mitigation: require successful artifact write and run-record emit before exit 0.

2. Risk: auth handling drifts into insecure token persistence.
Mitigation: store opaque session references only; redact sensitive values in output.

3. Risk: onboarding bypasses contract validation paths.
Mitigation: keep output schema-compatible and rely on existing validation commands/scripts.

## Implementation outline
1. Add auth profile store utility with domain-scoped session metadata and TTL checks.
2. Add run artifact emitter utility reusing current artifact shapes.
3. Add `init` command with prompt/non-interactive input resolution.
4. Add `auth` subcommands (`list`, `test`, `clear`).
5. Add CLI tests for init/auth workflows.
6. Build and run package tests.
