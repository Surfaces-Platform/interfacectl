# interfacectl CLI API Documentation

## Overview

`interfacectl` is a command-line tool for managing interface contracts in the Surfaces ecosystem. It validates, compares, and enforces compliance between defined interface contracts and actual implementation artifacts across multiple surfaces.

In an interactive terminal, running bare `interfacectl` with no arguments opens the first-run onboarding screen. In non-interactive contexts, bare `interfacectl` keeps the existing help output and exit behavior so scripts and CI remain stable.

## Generation-time gating

`interfacectl validate` is the canonical command for contract compliance. Use it to gate changes before merge or deployment. For deterministic, category-based exit codes, use `--exit-codes v2` or set `INTERFACECTL_EXIT_CODES=v2`. The command `enforce --mode fail` runs a structural diff and applies a policy threshold. It is optional and useful when you want to block on diff severity separately from compliance. For the minimal contract format and where contract semantics live in the repo, see [docs/contract-baseline.md](docs/contract-baseline.md).

## Commands

### `init`

First-run onboarding for web surfaces.

**Synopsis:**
```bash
interfacectl init [options]
```

**Description:**
`init` is the primary user-facing entry point for Surfaces onboarding on web surfaces. It:
- analyzes either a local app root (`--app-root`) or a live URL (`--url`)
- classifies the surface as `marketing`, `application`, or `unknown` using platform-owned heuristics
- extracts UI-system attributes across typography, color, layout, motion, icons, shell/auth primitives, sections, and copy-role signals
- decides whether to adopt an existing design system or synthesize a first draft from repeated norms
- writes four artifacts under `contracts/generated/`
- validates preview artifacts before write and, in interactive mode, asks for confirmation before writing anything

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--url <url>` | Surface URL for remote onboarding | none |
| `--app-root <path>` | Local app root for source-backed onboarding | none |
| `--extract-mode <remote-url\|local-root>` | Source mode override | inferred from inputs |
| `--surface <id>` | Surface identifier override | inferred from URL/path |
| `--surface-name <name>` | Surface display name override | derived from surface id |
| `--surface-kind <marketing\|application\|unknown>` | Confirm low-confidence classification in non-interactive flows | inferred |
| `--auth-profile <name>` | Replay a saved browser-session auth profile for protected remote onboarding | none |
| `--non-interactive` | Disable prompts | `false` |
| `--continue-on-gate` | Allow provisional output when remote onboarding resolves to a login or access-denied page | `false` |
| `--out-dir <path>` | Output directory for generated artifacts | `contracts/generated` |
| `--analysis-out <path>` | Explicit output path for `<surface>.analysis.json` | derived from `--out-dir` |
| `--draft-out <path>` | Explicit output path for `<surface>.design-system.draft.json` | derived from `--out-dir` |
| `--contract-out <path>` | Explicit output path for `<surface>.contract.json` | derived from `--out-dir` |
| `--report-out <path>` | Explicit output path for `<surface>.extraction.json` | derived from `--out-dir` |

**Artifacts:**

- `contracts/generated/<surface>.analysis.json`
- `contracts/generated/<surface>.design-system.draft.json`
- `contracts/generated/<surface>.contract.json`
- `contracts/generated/<surface>.extraction.json`

**Notes:**
- First-run output is warn-first. Findings are surfaced in the summary rather than blocking the onboarding command unless artifact generation or validation infrastructure fails.
- If surface-kind inference is low confidence, interactive mode asks for confirmation. Non-interactive mode must pass `--surface-kind`.
- For protected remote URLs, `--auth-profile` must point at a replay-ready profile. Interactive `init` can capture one; non-interactive mode fails fast if the profile is missing, expired, legacy, or not replayable.
- If a remote URL resolves to a login or access-denied page, interactive mode stops and offers next actions before any artifacts are written. Non-interactive mode must pass `--continue-on-gate` to accept provisional output.
- First-party or dogfood surfaces are not used as baselines for inference or starter recommendations.

---

### `analyze`

Machine-readable first-run analysis for web surfaces.

**Synopsis:**
```bash
interfacectl analyze [options]
```

**Description:**
`analyze` uses the same first-run analysis engine as `init` but writes only the analysis artifact. It is intended for power users and CI preparation when you want explainable classification and extraction evidence without generating the draft contract/draft-system artifacts.

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--url <url>` | Surface URL for remote analysis | none |
| `--app-root <path>` | Local app root for source-backed analysis | none |
| `--extract-mode <remote-url\|local-root>` | Source mode override | inferred from inputs |
| `--surface <id>` | Surface identifier override | inferred from URL/path |
| `--surface-name <name>` | Surface display name override | derived from surface id |
| `--surface-kind <marketing\|application\|unknown>` | Optional classification confirmation override | inferred |
| `--auth-profile <name>` | Replay a saved browser-session auth profile for protected remote analysis | none |
| `--out <path>` | Output file path for the analysis artifact | `contracts/generated/<surface>.analysis.json` |
| `--out-dir <path>` | Output directory when `--out` is not supplied | `contracts/generated` |

**Output:**
- `contracts/generated/<surface>.analysis.json`

---

### `auth`

Manage replayable browser-session auth profiles for protected remote onboarding.

**Synopsis:**
```bash
interfacectl auth <subcommand> [options]
```

**Subcommands:**

#### `auth capture`

Launches Chromium, opens a clean browser context, waits for manual sign-in, then stores the resulting Playwright `storageState` as a replayable auth profile.

```bash
interfacectl auth capture --profile <name> --url <exact-host-url> [--format text|json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--profile <name>` | Profile name | required |
| `--url <url>` | URL on the exact host to capture | required |
| `--format <text\|json>` | Output format | `text` |

Notes:
- Profiles are exact-host scoped in v1. If capture ends on a different hostname, the command fails and requires a capture on that host instead.
- Replay state is stored separately from metadata. `interfacectl` uses keychain-first storage with encrypted local-file fallback.
- Generated onboarding artifacts and CLI JSON outputs never include cookies, storage entries, or tokens.

#### `auth list`

Lists locally stored auth profiles and their replay readiness.

```bash
interfacectl auth list [--format text|json]
```

The output includes `status`, `replayReady`, `capturedAt`, `expiresAt`, and storage mode metadata.

#### `auth test`

Validates a local auth profile. Without `--url`, it checks replay readiness only. With `--url`, it performs a real replayed navigation using the same browser observer as remote onboarding.

```bash
interfacectl auth test --profile <name> [--domain <host>] [--url <protected-url>] [--format text|json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--profile <name>` | Profile name | required |
| `--domain <domain>` | Optional exact-host scope override | inferred from `--url` when present |
| `--url <url>` | Protected URL to validate authenticated replay against | none |
| `--format <text\|json>` | Output format | `text` |

Notes:
- If `--auth-profile` is explicitly supplied to `init` or `analyze`, interfacectl does not silently fall back to anonymous access.
- Legacy v1 profiles remain listable but are not replayable; they must be re-captured.

#### `auth revoke` / `auth clear`

Deletes local auth profile metadata and any stored replay state.

```bash
interfacectl auth revoke --profile <name> --domain <host>
interfacectl auth clear --all
```

If Chromium is not installed locally, install it with:

```bash
pnpm --filter @surfaces/interfacectl-cli exec playwright install chromium
```

---

### `validate`

Validates configured surfaces against a shared interface contract.

**Synopsis:**
```bash
interfacectl validate [options]
```

**Description:**
Performs comprehensive validation of surface implementations against an interface contract. This includes:
- Contract structure validation against schema
- Surface descriptor collection from codebase
- Compliance checking for fonts, colors, icon sources, layout, motion, and sections
- Generation of structured validation reports

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--contract <path>` | Path to the contract JSON file | `contracts/surfaces.web.contract.json` or `SURFACES_CONTRACT` env var |
| `--schema <path>` | Optional path to the contract schema JSON file | Bundled schema |
| `--config <path>` | Path to interfacectl config JSON file | `interfacectl.config.json` |
| `--root <path>` | Project root directory | Current working directory or `SURFACES_ROOT` env var |
| `--workspace-root <path>` | Workspace root directory (alias for `--root`) | Current working directory |
| `--surface <id...>` | Limit validation to specified surface identifiers | All surfaces |
| `--format <text\|json>` | Output format | `text` |
| `--json` | Emit JSON output (shortcut for `--format json`) | `false` |
| `--out <path>` | Write output to file instead of stdout | stdout |
| `--exit-codes <v1\|v2>` | Exit code version (default: v1, use v2 for new contract) | `v1` |

**Exit Codes:**

**v1 (legacy, default):**
- `0`: All surfaces comply with the contract
- `1`: Contract violations detected
- `2`: Configuration or contract loading error

**v2 (new contract, opt-in via `--exit-codes v2` or `INTERFACECTL_EXIT_CODES=v2`):**
- `0`: All surfaces comply with the contract
- `10`: E0 - Artifact invalid (config/contract load failures, schema parse errors, internal errors)
- `20`: E1 - Token policy violation (font/color/icon/motion not allowed)
- `30`: E2 - Interface contract violation (layout/section violations)

**Note:** v1 internal errors use exit code `2`. v2 unifies all E0 conditions to exit code `10`. Use `--exit-codes v2` to opt into the new exit code contract. A deprecation warning is printed in v1 mode when violations occur.

**Violation Types Detected:**
- `surface.unknown`: Surface ID not found in contract
- `descriptor.missing`: Surface descriptor not found in codebase
- `descriptor.unused`: Surface defined in contract but no descriptor found
- `section.missing`: Required section missing from surface
- `section.unexpected`: Unknown section in surface
- `font.disallowed`: Font not allowed by contract
- `color.disallowed`: Color not allowed by contract
- `icon.source-disallowed`: Icon source library not allowed by contract
- `layout.width-exceeded`: Layout width exceeds contract maximum
- `layout.width-undetermined`: Layout width cannot be determined
- `layout.container-missing`: Required container missing from layout
- `motion.duration`: Motion duration not allowed by contract
- `motion.timing`: Motion timing function not allowed by contract

**Output Format (JSON):**
```json
{
  "contractPath": "string",
  "contractVersion": "string | null",
  "summary": {
    "errors": "number",
    "warnings": "number"
  },
  "findings": [
    {
      "code": "string",
      "severity": "error | warning",
      "category": "E0 | E1 | E2",
      "surface": "string",
      "message": "string",
      "expected": "unknown",
      "found": "unknown",
      "location": "string"
    }
  ]
}
```

---

### `diff`

Compares a contract against observed artifacts and generates a detailed diff.

**Synopsis:**
```bash
interfacectl diff [options]
```

**Description:**
Performs a structural comparison between the contract definition and observed surface descriptors. Generates a comprehensive diff showing additions, removals, modifications, and renames. Includes drift risk detection and normalization support.

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--contract <path>` | Path to the contract JSON file | `contracts/surfaces.web.contract.json` or `SURFACES_CONTRACT` env var |
| `--schema <path>` | Optional path to the contract schema JSON file | Bundled schema |
| `--config <path>` | Path to interfacectl config JSON file | `interfacectl.config.json` |
| `--root <path>` | Project root directory | Current working directory or `SURFACES_ROOT` env var |
| `--workspace-root <path>` | Workspace root directory (alias for `--root`) | Current working directory |
| `--surface <id...>` | Limit diff to specified surface identifiers | All surfaces |
| `--format <text\|json>` | Output format | `text` |
| `--json` | Emit JSON output (shortcut for `--format json`) | `false` |
| `--out <path>` | Write output to file instead of stdout | stdout |
| `--no-normalize` | Disable normalization (for debugging) | Normalization enabled |
| `--rename-threshold <0-1>` | Rename detection threshold (0.0-1.0) | `0.8` |
| `--policy <path>` | Optional policy path (for policy metadata in output) | None |
| `--exit-codes <v1\|v2>` | Exit code version (default: v1, use v2 for new contract) | `v1` |

**Exit Codes:**

**v1 (legacy, default):**
- `0`: No differences found
- `1`: Differences detected (any severity)
- `2`: Configuration or contract loading error
- `3`: Internal error (preserved from existing behavior)

**v2 (new contract, opt-in via `--exit-codes v2` or `INTERFACECTL_EXIT_CODES=v2`):**
- `0`: No differences found
- `10`: E0 - Artifact invalid (config/contract load failures, schema parse errors, internal errors)
- `30`: E2 - Blocking drift (error or warning entries detected)
- `40`: E3 - Non-blocking drift (all entries are info severity after policy overrides)

**Note:** E3 (non-blocking drift) only exists in v2 and requires policy-driven severity downgrades to `info`. v1 always exits `1` if any entries exist, regardless of severity. A deprecation warning is printed in v1 mode when diffs exist.

**Diff Entry Types:**
- `added`: Path exists in observed but not in contract
- `removed`: Path exists in contract but not in observed
- `modified`: Path exists in both but values differ
- `renamed`: Path was renamed (detected via similarity threshold)

**Severity Levels:**
- `error`: Critical violation requiring immediate attention
- `warning`: Non-critical issue that may indicate drift
- `info`: Informational difference

Includes traceability fields.

**Drift Risks Detected:**
- `diff-noise`: Formatting-only or reorder-only changes filtered
- `semantic-ambiguity`: Diff entries lack rule/clause references
- `enforcement-overreach`: Semantic changes attempted in autofixes (only mechanical changes allowed)
- `policy-drift`: Policy fingerprint validation failed
- `contract-evolution`: Contract changes should be diffable
- `observed-instability`: Observed descriptors fail validation before diffing
- `rename-inflation`: Excessive rename detection (threshold too low)
- `output-schema-drift`: Output schema version mismatch
- `severity-inflation`: Policy has excessive error severity overrides
- `local-ci-mismatch`: Repro command missing from output

**Output Format (JSON):**
```json
{
  "schemaVersion": "1.0.0",
  "tool": {
    "name": "interfacectl",
    "version": "string"
  },
  "policy": {
    "version": "string",
    "fingerprint": "string"
  },
  "contract": {
    "path": "string",
    "version": "string"
  },
  "observed": {
    "root": "string"
  },
  "normalization": {
    "enabled": "boolean",
    "reorderedPaths": ["string"],
    "strippedPaths": ["string"]
  },
  "summary": {
    "totalChanges": "number",
    "byType": {
      "added": "number",
      "removed": "number",
      "modified": "number",
      "renamed": "number"
    },
    "bySeverity": {
      "error": "number",
      "warning": "number",
      "info": "number"
    }
  },
  "entries": [
    {
      "path": "string",
      "type": "added | removed | modified | renamed",
      "severity": "error | warning | info",
      "surfaceId": "string",
      "contractValue": "unknown",
      "observedValue": "unknown",
      "rule": "string",
      "stableId": "string",
      "contractRef": { "path": "string", "surfaceId": "string", "sectionId": "string", "constraintId": "string" },
      "ruleRef": { "id": "string", "version": "string" },
      "rename": {
        "fromPath": "string",
        "toPath": "string",
        "confidence": "number"
      }
    }
  ],
  "driftRisks": [
    {
      "category": "string",
      "severity": "error | warning | info",
      "message": "string",
      "relatedPaths": ["string"]
    }
  ],
  "repro": {
    "command": "string"
  }
}
```

---

### `enforce`

Enforces policy on interface contract using configurable enforcement modes.

**Synopsis:**
```bash
interfacectl enforce [options]
```

**Description:**
Applies enforcement policies to interface contracts through three modes:
- **fail**: Runs a structural diff and exits with an error code when differences exceed the policy threshold
- **fix**: Applies safe, mechanical fixes based on policy rules
- **pr**: Generates patches for review (unified diff or JSON patch format)

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--mode <fail\|fix\|pr>` | Enforcement mode | `fail` |
| `--strict` | Alias for `--mode fail` (strict enforcement) | `false` |
| `--policy <path>` | Policy JSON path | Default policy |
| `--contract <path>` | Contract path | `SURFACES_CONTRACT` env var or default |
| `--root <path>` | Workspace root | `SURFACES_ROOT` env var or current directory |
| `--config <path>` | Config path | `interfacectl.config.json` |
| `--surface <id...>` | Filter surfaces | All surfaces |
| `--dry-run` | For fix mode, show what would change without applying | `false` |
| `--format <text\|json>` | Output format | `text` |
| `--json` | Emit JSON output (shortcut for `--format json`) | `false` |
| `--out <path>` | Output file path | stdout |
| `--exit-codes <v1\|v2>` | Exit code version (default: v1, use v2 for new contract) | `v1` |

**Enforcement Modes:**

1. **fail** (default):
   - Runs a structural diff between the contract and observed descriptors
   - Exits with an error code if differences exceed the policy threshold
   - Does not modify files
   - Suitable for CI when you want policy-based blocking on diff severity

2. **fix**:
   - Automatically applies safe fixes matching autofix rules
   - Only applies mechanical, non-semantic changes
   - Respects safety levels and rule patterns
   - Can run in `--dry-run` mode to preview changes

Includes traceability fields.

3. **pr**:
   - Generates patch files for review
   - Supports unified diff or JSON patch formats
   - Does not modify files directly
   - Suitable for automated PR generation

**Exit Codes:**

**v1 (legacy, default):**
- `0`: Enforcement passed (no violations or fixes applied successfully)
- `1`: Violations remaining or enforcement failed
- `2`: Configuration or policy loading error

**v2 (new contract, opt-in via `--exit-codes v2` or `INTERFACECTL_EXIT_CODES=v2`):**
- `0`: Enforcement passed (no violations or fixes applied successfully)
- `10`: E0 - Artifact invalid (config/policy load failures, internal errors)
- `30`: E2 - Differences exceed policy threshold (does not distinguish E1 vs E2 for exit codes)

**Note:** enforce does not distinguish E1 (token policy) vs E2 (interface contract) violations for exit codes - both return `30` in v2. However, JSON findings still carry `category: "E1"` or `category: "E2"` so downstream tools can see what happened. A deprecation warning is printed in v1 mode when violations exist.

**Output Format (JSON):**
```json
{
  "schemaVersion": "1.0.0",
  "mode": "fail | fix | pr",
  "policy": {
    "version": "string",
    "fingerprint": "string"
  },
  "applied": [
    {
      "ruleId": "string",
      "path": "string",
      "oldValue": "unknown",
      "newValue": "unknown",
      "confidence": "number",
      "stableId": "string",
      "contractRef": { "path": "string", "surfaceId": "string", "sectionId": "string", "constraintId": "string" },
      "ruleRef": { "id": "string", "version": "string" }
    }
  ],
  "skipped": [
    {
      "ruleId": "string",
      "path": "string",
      "oldValue": "unknown",
      "newValue": "unknown",
      "confidence": "number",
      "stableId": "string",
      "contractRef": { "path": "string", "surfaceId": "string", "sectionId": "string", "constraintId": "string" },
      "ruleRef": { "id": "string", "version": "string" }
    }
  ],
  "errors": [
    {
      "ruleId": "string",
      "path": "string",
      "message": "string",
      "stableId": "string",
      "ruleRef": { "id": "string", "version": "string" }
    }
  ]
}
```

---

### `compile`

Produces a deterministic directory bundle from a contract for runtime consumption. The bundle is readable, composable, and diffable. This is a build artifact, not an enforcement engine.

**Synopsis:**
```bash
interfacectl compile --contract <path> --out <dir> [--schema <path>] [--format json]
```

**Description:**
- Loads and validates the contract structure using the same validator as `validate`.
- Writes a bundle directory at `--out` with stable key ordering and deterministic JSON.
- Writes files atomically (temp then rename) where possible to avoid partial bundles.
- Exits non-zero on invalid contract or write failure.

**Options:**

| Option | Description |
|--------|-------------|
| `--contract <path>` | Path to the contract JSON file (required) |
| `--out <dir>` | Output directory for the bundle (required) |
| `--schema <path>` | Optional path to the contract schema JSON file |
| `--format <format>` | Output format (e.g. json) |

**Exit Codes:**
- `0`: Bundle written successfully
- `1`: Invalid contract (schema validation failed), missing file, or write failure

**Bundle structure**

The output directory contains:

| Path | Description |
|------|-------------|
| `manifest.json` | Bundle manifest with version, contract id/version, tool info, inputs, and file hashes |
| `contract.normalized.json` | Normalized full contract (stable key order, same information as source) |
| `surfaces/<surfaceId>.json` | One file per surface; surface data plus minimal metadata for runtime loading |
| `constraints/motion.json` | Motion constraint category (other categories may be added later) |

**Manifest fields**

| Field | Description |
|-------|-------------|
| `bundleVersion` | Format version for this bundle (e.g. `"1.0"`) |
| `contractId` | From the contract |
| `contractVersion` | From the contract (`version` field) |
| `schemaVersion` | Schema bundle identifier used by the CLI (e.g. `surfaces.web.contract@1`) |
| `tool` | `{ name: "interfacectl", version: "<version>" }` |
| `inputs` | `{ contractPath: string, schemaPath: string or null }` |
| `files` | Array of `{ path, sha256 }` for all bundle files except `manifest.json`, sorted lexicographically by `path`. Hashes are SHA-256 hex strings. |

No timestamps are included in the manifest so that bundles remain deterministic.

---

### `generate-contract` (Phase 0)

Extracts a deterministic contract artifact from a Next.js app by analyzing app code. **Extraction only** — no enforcement, no network calls. Output is schema-valid; extracted-only fields live under `x_extracted`.

**Synopsis:**
```bash
interfacectl generate-contract --app-root <path> --surface <id> [--out <path>] [--report-out <path>] [--schema <path>]
```

**Description:**
- Scans the app directory for routes (app router), layout shell (`app/layout.tsx` or `app/(shell)/layout.tsx`), `@surfaces/ui` component imports, and `/auth` routes.
- Seeds `color.allowedValues` from observed descriptors and seeds `surfaces[*].icons` for web surfaces with `policy: "warn"` plus discovered icon source libraries.
- Seeds `surfaces[*].layout.chromePolicy` conservatively when portable chrome markers are present and deterministic:
  - `.contract-container` for `layout-container`
  - top-level `data-contract-section` for `top-level-section`
  - optional `data-contract="page-container"` for `page-container`
  - legacy `data-contract-container` remains supported for compatibility
- Writes a contract JSON (default `contracts/generated/<surfaceId>.contract.json`) and an extraction report (default `contracts/generated/<surfaceId>.extraction.json`).
- Validates the generated contract against the schema before writing. Running the command twice produces identical output (stable key order, no timestamps).

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--app-root <path>` | Path to the Next.js app root (directory containing `app/`) | (required) |
| `--surface <id>` | Surface identifier (e.g. `surfaces-web`) | (required) |
| `--out <path>` | Output path for contract JSON | `contracts/generated/<surfaceId>.contract.json` |
| `--report-out <path>` | Output path for extraction report | `contracts/generated/<surfaceId>.extraction.json` |
| `--schema <path>` | Optional path to the contract schema JSON file | Bundled schema |

**Exit Codes:**
- `0`: Contract and report written successfully
- `1`: Schema validation failed for generated contract

**Phase 0 scope:** Routes, hasShell, designSystemComponents (from `@surfaces/ui`), authAware. Other fields use placeholders, conservative defaults, or descriptor seeding; the report lists warnings for omitted or ambiguous extraction.

**Phase 0 guardrails:** No Babel or heavy AST. Uses filesystem + regex for determinism, debuggability, and minimal deps. See [docs/plans/phase-0-extraction-guardrails.md](docs/plans/phase-0-extraction-guardrails.md) for extraction limits and when AST tooling may be added.

---

### `validate-extracted` (Phase 0.5)

Fails if the contract’s Phase 0 expectations (`surfaces[].phase0`) conflict with extracted reality. Use after `generate-contract` to gate policy vs. code.

**Synopsis:**
```bash
interfacectl validate-extracted --contract <path> --extracted <path> [--surface <id>] [--format text|json] [--out <path>] [--exit-codes v1|v2]
```

**Contract shape (policy only; no x_* in policy):**  
Optional per-surface block `surfaces[].phase0`:
- `authPosture`: `"public"` | `"auth-aware"` | `"auth-first"`
- `requiresShell`: boolean
- `expectsAuthRoutes`: boolean
- `expectsDesignSystem`: boolean

**Extracted input:** (1) Extraction report: `{ surfaceId, extracted: { routes, hasShell, designSystemComponents, authAware } }`. (2) Generated contract with `x_extracted`; use `--surface <id>` when surfaceId cannot be inferred.

**Validation rules:**  
Auth posture: auth-first ⇒ authAware true and all four auth routes; auth-aware ⇒ authAware true. Shell: requiresShell true and hasShell false ⇒ mismatch. Auth routes: when expectsAuthRoutes true, requires `/auth/login`, `/auth/callback`, `/auth/session`, `/auth/logout`. Design system: expectsDesignSystem true and empty designSystemComponents ⇒ mismatch.

**Findings:** Deterministic order (surfaceId, then code). Codes: `phase0.authPosture.mismatch`, `phase0.authRoutes.missing`, `phase0.shell.mismatch`, `phase0.designSystem.missing`. Category E2 for mismatches, E0 for load/parse errors.

**Exit codes (v2):**
- `0`: Success (no phase0 block or no mismatches).
- `10`: E0 (load/parse/schema or internal error).
- `30`: E2 (one or more mismatches).

---

## Traceability fields (Phase 2)

Diff and enforce JSON output include optional traceability fields for correlation and debugging. These fields are additive and optional; existing consumers should keep working.

- **stableId**: Deterministic correlation id (64-bit). Use for deduplication and change tracking within a repo or CI workflow. NOT a globally unique identifier. For cross-repo or large-fleet indexing, consider extending to 128 bits in a future phase.
- **contractRef**: Reference to contract structure when deterministically derivable. Fields: `path` (JSON pointer style), `surfaceId`, `sectionId`, `constraintId`. `contractRef.path` is omitted when the mapping is ambiguous or the node does not exist in the contract (e.g. surface-missing).
- **ruleRef**: `id` (and optional `version`) of the rule that produced the entry.

---

## Configuration

### Config File (`interfacectl.config.json`)

Maps surface IDs to their root directories in the codebase.

**Format:**
```json
{
  "surfaceRoots": {
    "surface-id": "path/to/surface/root",
    "another-surface": "apps/another-app"
  }
}
```

**Environment Variables:**
- `SURFACES_ROOT`: Default workspace root directory
- `SURFACES_CONTRACT`: Default contract file path
- `SURFACES_CONFIG`: Default config file path
- `INTERFACECTL_EXIT_CODES`: Exit code version (`v1` or `v2`, default: `v1`)

---

## Policy

Enforcement policies define:
- **Autofix rules**: Patterns and conditions for automatic fixes
- **Mode configurations**: Behavior for fail/fix/pr modes
- **Severity thresholds**: Minimum severity to trigger enforcement
- **Safety levels**: Controls for what types of changes are allowed
- **Fingerprint**: Cryptographic hash for policy integrity verification

---

## Key Features

### Contract Validation
- Schema validation against JSON Schema
- Structural validation of contract format
- Surface descriptor discovery and parsing
- Multi-surface compliance checking

### Diff Generation
- Structural comparison between contract and implementation
- Normalization to handle formatting differences
- Rename detection via similarity thresholds
- Drift risk identification and reporting

### Policy-based enforcement
- Rule-based autofix system
- Safety level enforcement (only mechanical changes)
- Confidence scoring for applied fixes
- Patch generation for review workflows

### Output Formats
- **Text**: Human-readable colored output with structured sections
- **JSON**: Machine-readable structured data with full details

### Surface Support
- Multiple surfaces in single contract
- Per-surface filtering and validation
- Surface-specific root directory mapping
- Cross-surface compliance checking

---

## Integration Examples

### CI/CD Validation (canonical gate)

Use validate with v2 exit codes for contract compliance in CI:

```bash
interfacectl validate --root . --contract ./contracts/ui.contract.json --format json --exit-codes v2
```

Or set the environment variable: `INTERFACECTL_EXIT_CODES=v2`.

### Pre-commit Hook (optional: policy-on-diff)

To block on structural diff severity in addition to validate:

```bash
interfacectl enforce --mode fail
```

### Automated Fixing
```bash
interfacectl enforce --mode fix --dry-run
interfacectl enforce --mode fix
```

### PR Generation
```bash
interfacectl enforce --mode pr --format json --out fix-patch.json
```

---

## Error Handling

All commands provide structured error reporting:
- Clear error messages with context
- Exit codes for programmatic handling
- JSON error output for machine parsing
- Detailed validation error listings

## Exit Code Reference (v2)

When using `--exit-codes v2` or `INTERFACECTL_EXIT_CODES=v2`:

**validate v2**: 0 / 10 / 20 / 30
- `0`: Fully compliant
- `10`: E0 - Artifact invalid
- `20`: E1 - Token policy violation
- `30`: E2 - Interface contract violation

**diff v2**: 0 / 10 / 30 / 40
- `0`: No diffs found
- `10`: E0 - Artifact invalid
- `30`: E2 - Blocking drift (error/warning entries)
- `40`: E3 - Non-blocking drift (all entries are info)

**enforce v2**: 0 / 10 / 30
- `0`: Enforcement passed (no violations or fixes applied successfully)
- `10`: E0 - Artifact invalid
- `30`: E2 - Differences exceed policy threshold (does not distinguish E1 vs E2 for exit codes)

**Note on v1 internal errors:** v1 internal errors may be `2` or `3` depending on command (diff uses `3` if it currently does); v2 unifies to `10`.

**Category Field:** The `category` field in JSON findings is stable and versioned with the output schema. It is always present (not optional) and not best-effort. Categories: `E0` (artifact invalid), `E1` (token policy), `E2` (interface contract), `E3` (drift non-blocking, diff v2 only).

**Compatibility:** v1 (default) behavior is preserved. Use `--exit-codes v2` to opt into the new exit code contract. Deprecation warnings are printed in v1 mode when violations occur. The default will change to v2 in a future major release.

---

## See Also

- Contract schema documentation
- Policy file format specification
- Surface descriptor format documentation
