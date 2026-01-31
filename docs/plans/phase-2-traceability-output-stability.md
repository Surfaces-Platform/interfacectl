# Phase 2 Traceability and Output Stability

## Purpose
Make diff and enforce outputs explainable and machine-correlatable over time. Reduce ambiguity without changing validation semantics or contract schema.

## Scope
In scope:
1. `diff` JSON output enrichment for traceability.
2. `enforce` JSON output enrichment for traceability.
3. Shared mapping rules so diff entries and enforce findings reference contract intent consistently.
4. Fixture-based tests that lock output shape and key fields.
5. API.md updates only if output fields change.

Out of scope:
1. New CLI commands.
2. `compile` or runtime bundle output.
3. `explain` command or code-to-text mapping.
4. Changes to validate compliance rules.
5. Contract schema changes.
6. Exit code changes.

## Desired properties
1. Deterministic output. Same inputs yield stable identifiers and stable references.
2. Traceability. Every diff entry and enforce finding carries references back to contract structure where deterministically derivable.
3. Minimalism. Add only fields that are used by downstream tools or needed for human debugging.

## Output additions

### Shared identifiers
Add these fields where applicable.

1. `contractRef`
   - `path`: JSON pointer style path into the contract, when deterministic.
   - `surfaceId`: surface identifier when available.
   - `sectionId`: section identifier when available.
   - `constraintId`: constraint category when applicable (example: motion).

2. `ruleRef`
   - `id`: stable string identifier for the rule or evaluator that produced the entry.
   - `version`: optional, only if a rule catalog exists.

3. `stableId`
   - Deterministic identifier for correlation across runs.
   - Computed from: command name, surfaceId, type, path, contractRef.path, ruleRef.id, plus a normalized representation of values when needed.

### `diff` JSON
For each entry:
1. Populate `contractRef.path` when the entry maps directly to a contract node.
2. Populate `ruleRef.id` when the diff logic can name the rule that produced the entry.
3. Populate `stableId` for every entry.

### `enforce` JSON
For each applied or skipped action and for any findings/errors:
1. Populate `contractRef` and `ruleRef` when deterministically known.
2. Populate `stableId` for each record so automated workflows can dedupe and track changes.

## Acceptance criteria
1. `diff --format json` emits `stableId` for every entry.
2. `diff` entries include `contractRef.path` for all cases where a contract node is unambiguous.
3. `enforce --format json` emits `stableId` for applied and skipped actions.
4. `enforce` output includes `contractRef` and `ruleRef` when deterministically derivable.
5. No changes to validate compliance semantics.
6. No schema changes.
7. A fixture test verifies stable output shape and stableId determinism for diff and enforce.

## Risks and guardrails
1. Do not invent semantic mappings. Only emit references when deterministic.
2. Do not add optional fields that will become de facto required. Keep additions minimal and documented.
3. stableId computation must be stable across OS and Node versions. Normalize inputs.

## Review checklist
1. Does the PR stay in scope.
2. Are new output fields documented in API.md.
3. Do tests prove determinism and shape.
4. Does output remain readable and not bloated.
