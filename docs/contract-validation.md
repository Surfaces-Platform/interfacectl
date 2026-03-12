# Contract Validation Reference

This page defines the canonical validation semantics around `interfacectl validate` and related contract-compliance commands.

Consumer repos may add wrapper commands, default contract paths, CI artifact locations, or adapter transports. Those are local concerns. Validation meaning stays here.

## Canonical validation commands

### `interfacectl validate`

Use `validate` as the authoritative contract-compliance gate for checked-out code.

`validate`:

- loads the contract and bundled schema
- collects static descriptors from the workspace
- evaluates compliance for structure, sections, layout, fonts, colors, icons, and motion
- returns structured findings and an exit code

Use `--format json --out <path>` when you want a machine-readable artifact for CI or downstream tooling.

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

### `Generation time`

Generators and adapter wrappers may provide earlier feedback loops, but they are still downstream of the same contract semantics.

- `descriptor` mode is useful for hosted tools or partial outputs.
- `workspace` mode is useful for local agents and CI checks.
- only a full workspace `validate` pass is the authoritative promotion gate for checked-out code

### `CI/CD time`

CI should run `validate` directly or run a wrapper that ends in `validate`.

Use JSON output for uploaded artifacts, dashboards, or audit trails. The artifact path itself is consumer-local.

### `Runtime (edge)`

Runtime consumers should read compiled or derived policy artifacts. They do not redefine validation semantics. See [Runtime (Edge) Enforcement Guide](./runtime-edge.md).

## Output semantics

Structured validation output should preserve:

- contract identity and version
- surface identity
- findings with stable codes, severity, and evidence
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
