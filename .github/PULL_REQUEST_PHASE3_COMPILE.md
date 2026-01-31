# Phase 3: interfacectl compile directory bundle

## Strategy check

- [x] I read "docs/strategy.md"
- [x] This PR strengthens the decision filter sentence (runtime bundle for consumption)
- [x] Enforcement timing is explicit: compile produces build artifact for runtime; validate remains generation-time gate
- [x] Violation handling is unchanged (no changes to validate compliance semantics)
- [x] CLI behavior is tied to contract semantics (bundle is compiled view of contract)

## What changed

- Added `interfacectl compile --contract <path> --out <dir> [--schema <path>] [--format json]`.
- Compile loads and validates the contract with the existing validator, then writes a deterministic directory bundle:
  - `manifest.json` (bundleVersion, contractId, contractVersion, schemaVersion, tool, inputs, files with sha256 sorted by path)
  - `contract.normalized.json` (stable key ordering, same information as source)
  - `surfaces/<surfaceId>.json` per surface
  - `constraints/motion.json` when motion exists
- Deterministic JSON (sorted keys, no timestamps). Atomic writes (temp then rename).
- Fixture-based tests: structure, determinism (two runs → identical manifest.files), golden output, invalid contract fails.
- API.md: compile command description, bundle structure overview, manifest field definitions.

## Why it matters

- Teams can produce a versioned, diffable bundle for runtime or edge consumers without implementing enforcement in the CLI.
- Bundle is readable, composable, and cacheable (manifest files list with sha256).
- Validate remains the canonical compliance gate; compile is a build artifact only.

## Contract and enforcement notes

1. No contract schema changes.
2. No changes to validate compliance semantics or exit codes.
3. No new commands beyond compile; no `gate` command.

## Tests

- **compile.test.mjs**
  - Structure: required files exist (manifest.json, contract.normalized.json, surfaces/, constraints/), manifest.files sorted by path, sha256 hex format, no manifest in files list.
  - Determinism: two compile runs → identical manifest.files (paths and hashes).
  - Golden: generated contract.normalized.json, surfaces/demo-surface.json, constraints/motion.json deep-equal expected fixtures.
  - Invalid contract (schema validation failure) → non-zero exit.
  - Missing required field (constraints) → non-zero exit.

## Phase 3 acceptance criteria (docs/plans/phase-3-compile-directory-bundle.md)

1. **AC1** ✅ `interfacectl compile --contract <fixture> --out <tmpdir>` creates manifest.json, contract.normalized.json, surfaces/<surfaceId>.json for each surface, constraints/motion.json when motion exists.
2. **AC2** ✅ manifest `files` list includes sha256 for every file except manifest itself, sorted by path.
3. **AC3** ✅ Bundles are deterministic; two runs produce identical sha256 sets for the same fixture.
4. **AC4** ✅ Compile fails with non-zero exit code on invalid contract.
5. **AC5** ✅ API.md includes compile command description, bundle structure overview, manifest field definitions.
6. **AC6** ✅ No changes to validate compliance semantics and no contract schema changes.

## Determinism and schema stability verification

### schemaVersion

- **How it is derived:** `schemaVersion` is a **fixed constant** in code: `"surfaces.web.contract@1"`. It is not read from the schema file, filesystem, or environment.
- **Deterministic:** Same value on every run and every machine. It does **not** depend on absolute paths, file mtimes, or environment-specific values.
- **Decision:** Use a stable constant. When a custom schema is supplied via `--schema`, `inputs.schemaPath` records it; `schemaVersion` continues to denote the bundled contract schema format. Fixture and expected manifest use this constant.

### JSON stringify behavior

- **Object keys:** Sorted recursively (lexicographically) via `sortKeysRecursive` before `JSON.stringify(..., null, 2)`. Ensures stable key order across runs.
- **Arrays:** Array **element order is preserved**. The stringify helper does not reorder arrays; it only recurses into elements. Set-like array sorting (e.g. `allowedFonts`, `requiredSections`, `allowedDurationsMs`) is done in `normalizeContract()` by documented semantic rule (those fields are set-like in the contract schema), not in the stringify helper.
- **Newlines/indentation:** Always `JSON.stringify(..., null, 2)` plus a single trailing newline. Stable and consistent.
- **sha256:** Computed from the exact string passed to `writeAtomic` (the same content written to disk). No separate read-back; hash matches file bytes.

## Review checklist (from plan)

- [x] Compile only validates structure and writes the bundle.
- [x] Outputs are deterministic and tested.
- [x] Manifest is complete and stable (no timestamps).
- [x] Docs are short, factual, and consistent with validate as canonical gate.
