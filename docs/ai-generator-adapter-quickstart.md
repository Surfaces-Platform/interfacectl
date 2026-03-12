# AI Generator Adapter Quick Start

Use this flow when a generator authors or modifies UI and you want immediate contract feedback at `Generation time`.

## Purpose

The generator adapter loop gives tools a stable verdict contract:

- `pass`
- `warn`
- `block`

The adapter is not a separate policy system. It translates generator output into the same contract-aware feedback loop that `interfacectl validate` uses for authoritative compliance checks.

## Integration flow

1. Load the target contract and surface id.
2. Choose execution mode:
   - `descriptor` for hosted builders or tools without a full checkout
   - `workspace` for local agents or CI jobs with a checkout
3. Convert generated output into a descriptor or point the adapter at the workspace.
4. Run generation guard checks so shell-boundary violations and other generation-time findings surface immediately.
5. In `workspace` mode, run full `interfacectl validate` and treat that result as the authoritative promotion gate.
6. Feed structured findings back into the generator and regenerate until the result is `pass` or an accepted `warn`.

## Mode guidance

### `descriptor`

Use `descriptor` mode for tools such as Lovable, Figma Make, or other hosted builders that do not operate inside a repo checkout.

- Always evaluate shell-boundary signals.
- Evaluate any additional parity checks that the consumer repo enables for descriptor-mode rollout.
- Never treat descriptor-only success as the final shipping gate.

### `workspace`

Use `workspace` mode for tools such as Codex, Cursor, Claude Code, or any local generator that can inspect the real repo state.

- Run generation guard checks first for fast feedback.
- Run full `interfacectl validate` before promotion or merge.
- Prefer deterministic exit-code modes in CI so generated changes can be blocked cleanly.

## Adapter outputs

Every adapter wrapper should return:

- `requestId`
- `status`
- `findings`
- `coverage`
- `contract` metadata
- `timings`
- `provenance`

See [AI Generator Adapter API](./ai-generator-adapter-api.md) for the canonical request/response contract.

## Consumer wiring

Consumer repos may expose the adapter through wrapper commands, HTTP endpoints, editor tasks, or MCP tools. Those entrypoints are repo-local concerns. They should preserve the canonical verdict semantics documented here and in the adapter API.

## Related docs

- [AI Generator Adapter API](./ai-generator-adapter-api.md)
- [AI Tool Playbooks](./ai-tool-playbooks.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
- [Shell Boundary Semantics](./shell-boundary.md)
- [Generation Boundaries Guide](./generation-boundaries.md)
