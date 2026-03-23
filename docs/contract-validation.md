# Contract Validation Reference

This page defines the canonical validation semantics around `interfacectl validate` and related contract-compliance commands.

Consumer repos may add wrapper commands, default contract paths, CI artifact locations, or adapter transports. Those are local concerns. Validation meaning stays here.

## Canonical validation commands

### `interfacectl validate`

Use `validate` as the authoritative contract-compliance gate for checked-out code.

`validate`:

- loads the contract and bundled schema
- collects static descriptors from the workspace
- optionally augments those descriptors with browser observation when `--remote-url` is provided
- evaluates compliance for structure, sections, layout, fonts, colors, icons, motion, flows, interactive targets, and async feedback / recovery states
- returns structured findings and an exit code

Use `--format json --out <path>` when you want a machine-readable artifact for CI or downstream tooling.

`validate` is the canonical source of truth for both authored findings from checked-out code and observation-backed findings from accessible live routes. Consumer repos may wrap the output, but they should not redefine the meaning of the finding codes or the exit-code contract.

### `interfacectl validate-extracted`

Use `validate-extracted` when you need to compare declared policy in the contract with extracted Phase 0 reality from a generated report or extraction artifact.

This is a focused expert command. It complements `validate`; it does not replace it.

### `interfacectl enforce --mode fail`

Use `enforce --mode fail` only when you want an additional policy threshold on top of diff severity.

It is not the canonical compliance command. The canonical compliance command is still `validate`.

## Exit-code guidance

For deterministic automation, prefer `--exit-codes v2`.

- `0`: validation succeeded
- `10`: artifact/config/schema/internal failure
- `20`: token-policy violation
- `30`: interface-contract violation

Legacy `v1` exit codes remain available for compatibility, but new CI and generator flows should prefer `v2`.

## Validation at different lifecycle points

## Finding families

### Static workspace validation

Without `--remote-url`, `validate` works from checked-out code and extracted descriptors. This is the authoritative path for:

- structure, sections, layout, fonts, colors, icons, and motion
- authored flow definitions and flow-descriptor linkage
- authored async-state and recovery markers
- authored interactive target metadata

Representative finding codes from this path include:

- `descriptor.flows.missing`
- `flow.required.missing`
- `flow.steps.min`
- `flow.steps.required`
- `flow.transition.required`
- `flow.terminal.invalid`
- `feedback.state-missing`

### Browser-observed validation

With `--remote-url`, `validate` augments the checked-out surface with Chromium-based observation of the live route. This is the authoritative path for:

- measured target hit area, gap, edge inset, and destructive-action separation
- observed flow wrappers, steps, transitions, and terminal states
- observed async states, recovery actions, pending-action blocking, and preserved last-good content

Representative finding codes from this path include:

- `target.hit-area-too-small`
- `target.gap-too-tight`
- `target.edge-inset-too-small`
- `target.destructive-too-close`
- `target.unobservable`
- `flow.unobservable`
- `feedback.recovery-action-missing`
- `feedback.pending-action-not-blocked`
- `feedback.last-good-content-missing`
- `feedback.unobservable`

### `Generation time`

Generators and adapter wrappers may provide earlier feedback loops, but they are still downstream of the same contract semantics.

- `descriptor` mode is useful for hosted tools or partial outputs.
- `workspace` mode is useful for local agents and CI checks.
- only a full workspace `validate` pass is the authoritative promotion gate for checked-out code

### `CI/CD time`

CI should run `validate` directly or run a wrapper that ends in `validate`.

For workspace-only promotion, run `validate` against the checked-out repo. For accessible live routes, CI may add `--remote-url` to capture browser-observed target, flow, and feedback findings in the same canonical payload.

Use JSON output for uploaded artifacts, dashboards, or audit trails. The artifact path itself is consumer-local.

### `Runtime (edge)`

Runtime consumers should read compiled or derived policy artifacts. They do not redefine validation semantics. `validate --remote-url` is the canonical browser-observation path when you need to prove that runtime output still exposes the required target-acquisition, flow, and async-state markers. See [Runtime (Edge) Enforcement Guide](./runtime-edge.md).

## Output semantics

Structured validation output should preserve:

- contract identity and version
- surface identity
- findings with stable codes, severity, and evidence
- whether evidence came from workspace descriptors, browser observation, or both
- enough metadata for downstream tooling to explain or audit the decision

Transport details such as HTTP status codes, repo-local file names, or dashboard field names are consumer-local and should not reinterpret the meaning of findings or exit codes.

## Repo-local concerns that stay outside this doc

These belong in consumer repos, not here:

- wrapper commands such as `pnpm validate:*`
- default contract file locations
- CI artifact upload paths
- published quick-start pages
- generator-host-specific rollout switches

## Related docs

- [API reference](../API.md)
- [Contract baseline](./contract-baseline.md)
- [Runtime (Edge) Enforcement Guide](./runtime-edge.md)
- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
