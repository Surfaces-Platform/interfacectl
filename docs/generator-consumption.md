# Generator-Aware Contract Consumption

This document defines how generators should consume compiled generation bundles to improve first-pass accuracy and then correct drift after generation.

## Use the bundle twice

Generators should use the bundle in two loops:

1. **Before generation** with `prepare-generation` to obtain one resolved, agent-ready payload.
2. **After generation** with `validate-generation` to evaluate the produced output and feed findings back into the next attempt.

Using only the second loop turns the contract into a blocker. Using both loops makes it an authoring aid.

## Local-agent flow

For workspace agents:

1. Run `interfacectl compile --contract <path> --out <bundleDir>`.
2. Run `interfacectl prepare-generation --bundle-root <bundleDir> --surface <id>`.
3. Optionally run `interfacectl init-generation-session --bundle-root <bundleDir> --surface <id> --workspace-root <path>` when you want tracked iteration evidence.
4. Feed the resulting prepared JSON into the agent.
5. Generate only inside the surface-owned boundary.
6. Either run `interfacectl validate-generation --mode workspace` directly, or run `interfacectl record-generation-attempt` for a tracked session.
7. Feed structured findings back into the next attempt.

The prepared payload is the canonical handoff for local agents. Do not make each agent re-load and merge sibling bundle files independently.

## What the prepared payload must carry

Local agents need these resolved inputs:

- boundary and ownership rules
- structure, required sections, and flow summary
- layout constraints and viewport hints
- visual policy and selected profiles
- sections and referenced components
- cross-cutting constraints
- deterministic repair actions
- optional authoring hints
- bundle and contract provenance

The payload must include only evidence refs, never inline extracted observation payloads.

## Findings are generation input

Generators should not treat findings as human-only diagnostics.

- `shell-owned-primitive-emitted` means the next attempt must stay inside the surface boundary.
- `color.disallowed` means the next attempt must restrict itself to the allowlist.
- `icon.source-disallowed` means the next attempt must pick an allowed icon library.
- layout, landing-pattern, typography, and flow findings should be translated into concrete repair instructions from the bundle repair map.

## Provenance expectations

Generated output should carry enough provenance for later inspection:

- `surfaceId`
- `contractId`
- `contract version`
- bundle version when a consumer stores it

Embedding patterns vary by consumer, but the goal is consistent traceability from generated output back to the bundle that shaped it.

## Limits of the canonical payload

The prepared payload is intentionally tool-neutral.

- It is not a model-specific prompt pack.
- It does not replace `validate-generation`.
- It does not inline raw extraction evidence.
- It does not try to cover hosted descriptor flows, which remain on the adapter path.

## Tracked sessions

When you need auditable iteration history, use the canonical session commands rather than a repo-local harness:

1. `interfacectl init-generation-session`
2. `interfacectl record-generation-attempt`
3. `interfacectl summarize-generation-session`

These commands write session artifacts under `artifacts/generation-sessions/...` and emit canonical `contract-runs.json` / `contract-lineage.json` updates into the workspace.

## Related docs

- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [AI Generator Adapter API](./ai-generator-adapter-api.md)
- [Shell Boundary Semantics](./shell-boundary.md)
