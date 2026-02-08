# Enforcement Taxonomy

Use these terms consistently across plans, docs, and implementation notes.

## Lifecycle contexts

1. `Generation time`
- Definition: when an AI or tooling system authors or modifies interface code/artifacts.
- Examples: Lovable, Figma Make, Claude Code, codegen workflows.
- Decision: can this output be generated at all?

2. `CI/CD time`
- Definition: post-generation, pre-deploy checks in pull request/build/release pipelines.
- Examples: `interfacectl validate`, `interfacectl diff`, `interfacectl enforce --mode fail`.
- Decision: can this change ship?

3. `Runtime (edge)`
- Definition: live request-time behavior at CDN/serverless edge after deployment.
- Examples: manifest-driven edge adapters that allow/block/constrain live adaptations.
- Decision: can this adaptation/render happen for this request?

## Boundary rules

- `Edge` is a runtime location, not a separate lifecycle phase.
- If checks run on commits/artifacts in a pipeline, classify as `CI/CD time`.
- If checks run on live requests/sessions, classify as `Runtime (edge)`.
- If a tool is writing UI/code output, classify as `Generation time`.

## Artifact and tool mapping

1. `Generation time`
- Artifacts: source contracts, generator policy/boundary profile, optional extracted contract snapshots.
- Tools: generators plus contract-aware generation instructions.

2. `CI/CD time`
- Artifacts: source contracts, extracted descriptors, validate/diff/enforce outputs.
- Tools: `interfacectl validate`, `interfacectl diff`, `interfacectl enforce --mode fail`.

3. `Runtime (edge)`
- Artifacts: compiled runtime bundle/manifest, per-surface constraint slice, violation payload events.
- Tools: `interfacectl compile` output + edge adapter/handler + telemetry sink.

## Current platform intent

- Primary prevention should happen at `Generation time`.
- Primary shipping gate should happen at `CI/CD time`.
- `Runtime (edge)` is defense-in-depth and request-time control.
