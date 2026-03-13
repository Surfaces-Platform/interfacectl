# AI Tool Playbooks

This page shows how generators should use the same compiled bundle and verdict loop across local agents, IDE coders, hosted builders, and template engines.

## Shared model

All tools should follow the same pattern:

1. Compile the target contract into a bundle.
2. For local agents, materialize that bundle with `prepare-generation`.
3. Generate or edit UI.
4. Validate the result against the same bundle.
5. Keep CI or workspace validation as the final shipping gate.

The transport can change. The bundle semantics and `pass|warn|block` verdict do not.

## Agentic coders

Examples: Codex, Cursor, Claude Code, repo-local codegen workflows.

Recommended flow:

1. Run `interfacectl compile`.
2. Run `interfacectl prepare-generation` for the target surface.
3. Feed the prepared JSON into the agent context or repo-local wrapper.
4. Generate directly in the repo.
5. Run `interfacectl validate-generation --mode workspace`.
6. Treat `block` as a hard stop and feed findings back into the next attempt.

These tools should consume the prepared generation payload, not the raw contract or sibling bundle files directly.

When you want tracked iteration evidence around a local-agent loop, pair `prepare-generation` and `validate-generation` with a repo-local session harness that freezes one bundle revision, records each assessment, and aggregates recurring repair codes.

## Hosted builders

Examples: Lovable, Figma Make, or other tools that produce UI outside the repo.

Recommended flow:

1. Compile the bundle for the target surface.
2. Map generated output into a descriptor.
3. Submit the descriptor to the HTTP adapter.
4. Surface returned findings in-product.
5. Keep a workspace or CI fallback for final promotion.

Hosted tools stay on the descriptor path for now; `prepare-generation` is the local-agent handoff.

## Template engines and scaffolds

Examples: internal generators, boilerplate scaffolds, CMS-to-code exporters.

Recommended flow:

1. Compile the bundle.
2. Use `prepare-generation` as the canonical input payload.
3. Emit provenance in generated output.
4. Run descriptor or workspace validation as part of generation.
5. Fail the job on `block`.

## What can vary by tool

- how the prepared JSON is injected into prompts or generation config
- whether the tool validates first in `descriptor` or `workspace` mode
- how findings are surfaced back to the user
- whether publish/export can be blocked in-product or only in CI

## What must stay stable

- bundle semantics
- shell-boundary meaning
- `pass|warn|block` verdict meaning
- the use of CI or workspace validation as the final shipping gate

## Related docs

- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [AI Generator Adapter API](./ai-generator-adapter-api.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
- `packages/interfacectl-cli/schemas/prepare-generation-output.schema.json`
- [Shell Boundary Semantics](./shell-boundary.md)
