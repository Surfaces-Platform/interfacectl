# AI Tool Playbooks

This page shows how generators should use the same contract and verdict loop across local agents, IDE coders, hosted builders, and template engines.

## Shared model

All tools should follow the same pattern:

1. Load the target contract and surface id before generation.
2. Constrain generation with the contract instead of treating validation as a post-hoc lint step.
3. Validate generated output through an adapter or a workspace validation flow.
4. Feed structured findings back into the generator context and regenerate when needed.
5. Keep `interfacectl validate` as the final CI/CD gate.

The transport can change. The contract semantics do not.

## Agentic coders

Examples: Codex, Cursor, Claude Code, repo-local codegen workflows.

Recommended flow:

1. Read the contract and identify the target surface.
2. Generate directly in the repo or a checked-out workspace.
3. Run `workspace` mode or `interfacectl validate`.
4. Treat `block` as a hard stop.
5. Feed findings back into the next generation attempt.

These tools benefit most from the full workspace path because they can validate against the actual repo state before code lands.

## Hosted builders

Examples: Lovable, Figma Make, or other tools that produce UI outside the repo.

Recommended flow:

1. Map generated output into a descriptor.
2. Submit the descriptor to an adapter wrapper.
3. Surface the returned findings in-product.
4. Gate export or publish on `block` whenever the host allows it.
5. Keep a CI fallback that runs workspace validation before merge or deploy.

Hosted tools usually start with `descriptor` mode and rely on a later workspace gate for authoritative promotion.

## Template engines and scaffolds

Examples: internal generators, boilerplate scaffolds, CMS-to-code exporters.

Recommended flow:

1. Use the contract as an input spec for allowed structure, layout, color, icon, motion, and shell boundary rules.
2. Emit provenance in generated output.
3. Produce descriptors or run workspace validation as part of generation.
4. Fail the generation job when a blocking finding is returned.

## What can vary by tool

- how the contract is injected into prompts or generation config
- whether the tool uses `descriptor` or `workspace` mode first
- how findings are surfaced back to the user
- whether publish/export can be blocked in-product or only in CI

## What must stay stable

- contract semantics
- shell-boundary meaning
- `pass|warn|block` verdict meaning
- the use of CI/CD validation as the final shipping gate

## Related docs

- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [AI Generator Adapter API](./ai-generator-adapter-api.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
- [Shell Boundary Semantics](./shell-boundary.md)
