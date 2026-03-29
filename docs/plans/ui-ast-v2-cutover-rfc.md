# UI AST V2 Cutover RFC

## Decision

Adopt UI AST v2 as the canonical semantic contract for governed UI in `interfacectl`.

Legacy `web.surface.contract` remains supported only as a migration input. It is no longer the canonical artifact.

## Why

- Intent needs a bounded, reviewable artifact before rendering.
- Generation should stop handing arbitrary UI code directly to downstream systems.
- Governance, accessibility, and design-system checks should run at the semantic boundary instead of after implementation drift appears.
- Multi-platform output needs one durable source of truth for node identity, actions, and policy metadata.

## Scope

v1 AST scope is limited to governed application surfaces:

- settings pages
- forms
- onboarding flows
- transactional detail views
- empty states
- alerts and confirmations
- simple list and table surfaces
- account and preference management

Excluded from the first rollout:

- marketing pages
- bespoke editorial experiences
- unconstrained canvases
- custom data visualizations
- animation-led or experimental interaction models

## Canonical Artifact

Canonical input path:

- `contracts/ui.surface.ast.json`

Primary CLI flag:

- `--ast`

Legacy compatibility input:

- `--contract` for existing `web.surface.contract` JSON
- deprecated and migration-oriented only

## Bundle Changes

Compiled bundles now use format `3.0`.

Canonical bundle source files:

- `ast/normalized.json`
- `surfaces/<surface>/ast.json`
- `surfaces/<surface>/platforms.json`

Compatibility output remains available for downstream consumers that still need contract-shaped data:

- `derived/contract.normalized.json`

## Implementation Notes

- Validator owns the UI AST schema and bounded vocabulary.
- CLI resolves AST first, falls back to legacy contracts, and migrates legacy input into AST drafts deterministically.
- `compile`, `prepare-generation`, and `prepare-runtime` now treat AST as the normalized source artifact.
- `migrate-ui-ast` imports legacy contracts into AST drafts and emits escalation markers when semantics cannot be preserved safely.

## Rollout

Phase 1:

- land AST schema, migration command, bundle v3, and AST-aware preparation flows in `interfacectl`

Phase 2:

- prove consumer compatibility in `surfaces-webapps` on `benchmark-async-data-web`
- validate the live fixture against the AST draft
- compile and prepare generation/runtime payloads from the AST-derived bundle

Phase 3:

- migrate additional governed surfaces
- remove legacy contract-as-canonical assumptions from downstream tooling

## Guardrails

- Semantics over presentation
- Stable node identity across generation, approval, rendering, and observation
- Bounded vocabulary over free-form styling
- Governance metadata is first-class
- Unsupported cases fail closed or escalate

## Exit Criteria

- AST schema fixtures cover valid ASTs plus unsupported styling, logic, ids, and vocabulary failures
- bundle v3 is deterministic and proven with multi-platform projections
- migration from legacy contracts is deterministic and test-covered
- `surfaces-webapps` consumes AST-derived bundles on at least one governed benchmark surface
