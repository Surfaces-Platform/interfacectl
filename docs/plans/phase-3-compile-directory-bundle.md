# Phase 3 Compile Directory Bundle

## Purpose
Add `interfacectl compile` to produce a deterministic directory bundle for runtime consumption. The bundle must be readable, composable, and diffable. This is a build artifact, not an enforcement engine.

## Scope
In scope:
1. Add `interfacectl compile`.
2. Produce a deterministic directory bundle from a contract input.
3. Include a manifest with file hashes for integrity and cacheability.
4. Add fixture-based tests that lock bundle structure and determinism.
5. Document the command and bundle format in API.md.

Out of scope:
1. Runtime enforcement execution.
2. Policy evaluation or severity gating in runtime.
3. Explain or remediation output.
4. Contract schema changes.
5. Any changes to validate compliance semantics.
6. Any new commands beyond compile.

## Command

### CLI
`interfacectl compile --contract <path> --out <dir> [--schema <path>] [--format json]`

### Behavior
1. Loads and validates the contract structure using the existing validator.
2. Produces a bundle directory at `--out`.
3. Writes files atomically where possible (write temp then rename) to avoid partial bundles.
4. Produces deterministic JSON output with stable key ordering.
5. Exits non-zero on invalid contract or write failure.

## Bundle format

### Output directory
Default recommended layout:
`<out>/<contractId>/<contractVersion>/`

The command must not assume this layout unless the user omits `--out`. If `--out` is provided, treat it as the bundle root.

### Required files
1. `manifest.json`
2. `contract.normalized.json`
3. `surfaces/`
4. `constraints/`

Optional files (only if the contract actually represents them today):
1. `sections/` if sections are modeled as reusable units

### manifest.json
Fields:
1. `bundleVersion`: string, format version for this bundle
2. `contractId`
3. `contractVersion`
4. `schemaVersion`: from the contract schema bundle used by the CLI
5. `tool`: `{ name, version }`
6. `inputs`:
   - `contractPath`: string
   - `schemaPath`: string or null
7. `files`: array of `{ path, sha256 }` entries for all non-manifest files in the bundle

Notes:
1. Do not include timestamps in the manifest to preserve determinism.
2. The `files` list must be sorted by `path`.

### contract.normalized.json
A normalized representation of the contract:
1. Stable key ordering.
2. Stable ordering for arrays when possible without changing meaning.
3. Contains the same information as the source contract, not a new schema.

### surfaces
One file per surface:
`surfaces/<surfaceId>.json`

Each surface file contains only the data for that surface plus any minimal metadata needed for runtime loading.

### constraints
One file per constraint category:
`constraints/motion.json`

Additional categories may be added later.

## Determinism requirements
1. Same contract input and schema yield the same bundle content and the same sha256 hashes.
2. File ordering is stable.
3. JSON serialization is stable and cross-OS safe.

## Acceptance criteria
1. `interfacectl compile --contract <fixture> --out <tmpdir>` creates:
   - `manifest.json`
   - `contract.normalized.json`
   - `surfaces/<surfaceId>.json` for each surface
   - `constraints/motion.json` when motion exists
2. manifest `files` list includes sha256 for every file except manifest itself, sorted by path.
3. Bundles are deterministic. Two runs produce identical sha256 sets for the same fixture.
4. Compile fails with non-zero exit code on invalid contract.
5. API.md includes:
   - `compile` command description
   - bundle structure overview
   - manifest field definitions
6. No changes to validate compliance semantics and no contract schema changes.

## Risks and guardrails
1. Bundle must not become a second contract format. It is a compiled view.
2. Keep file boundaries aligned to human comprehension and runtime loading needs.
3. Avoid timestamps. If a build stamp is needed later, add it under a separate plan.

## Review checklist
1. Does compile only validate structure and write the bundle.
2. Are outputs deterministic and tested.
3. Is manifest complete and stable.
4. Are docs short, factual, and consistent with validate as canonical gate.
