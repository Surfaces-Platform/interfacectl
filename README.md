# interfacectl

Interface contract tooling for the Surfaces ecosystem. Validates, compares, and enforces compliance between defined interface contracts and actual implementation artifacts across multiple surfaces.

## Planning

All feature work must align with docs/plans/contract-first-enforcement-alignment.md.

## Feature planning requirement

Before planning or implementing any feature, read "docs/strategy.md" and produce a short "Feature Plan" that explicitly maps the work to the strategy decision filter and enforcement model.
Use timing terms from "docs/taxonomy.md" (generation time, CI/CD time, runtime (edge)).

See "docs/feature-plan.template.md".

This repository contains three packages:

- **`@surfaces/interfacectl-validator`** — Core validation library with TypeScript types, schema validation, and bundled contract schema definitions. Provides the foundation for contract validation.

- **`@surfaces/interfacectl-cli`** — Command-line interface that consumes the validator to run contract checks from any repository. Most users only need this package.

- **`@surfaces/interfacectl-extractor`** — Library that extracts a contract from a Next.js app (Phase 0). Used by the CLI `init`, `analyze`, and `generate-contract` flows. Exports `extractContractFromNextApp({ appRoot, surfaceId })`.

## Requirements

- **Node.js**: >=18.20.0 or >=20.10.0 (required for `with { type: "json" }` import syntax support)
- **pnpm**: 10.26.2 (specified in `packageManager` field)

## Installation

Install the CLI package as a development dependency:

```bash
pnpm add -D @surfaces/interfacectl-cli
```

In an interactive terminal, the first step is simply:

```bash
interfacectl
```

## Quick Start

In an interactive shell, `interfacectl` opens the terminal onboarding screen and immediately asks whether you want to inspect a local app root or a live URL.

For explicit command-driven onboarding, start with `init`:

```bash
interfacectl init --app-root apps/my-app --surface my-app
```

This inspects your surface, classifies it as `marketing`, `application`, or `unknown`, drafts a schema-valid contract, and emits a first design-system draft from repeated UI norms. For detailed command documentation, see [API.md](API.md).

For protected remote apps, capture a replayable browser session first:

```bash
interfacectl auth capture --profile staging-admin --url https://app.example.com/login
interfacectl init --url https://app.example.com --surface customer-app --auth-profile staging-admin
```

`interfacectl` replays the saved browser session in Chromium, analyzes the rendered authenticated page, and keeps auth state out of generated artifacts.

## Ownership

`interfacectl` is the canonical source of truth for reusable onboarding behavior, auth-gate semantics, artifact generation, and validator-facing platform rules. Consumer repos such as `surfaces-webapps` may provide product-specific onboarding UI or API wrappers, but they should delegate to `interfacectl` rather than reimplement onboarding logic locally.

## Commands Overview

The CLI provides two first-run commands, browser-session auth helpers, and the validation and enforcement commands:

### `init`

First-run onboarding for web surfaces. `init` analyzes either a local app root or a URL, validates a draft contract and design-system artifact in preview first, and in interactive mode only writes artifacts after confirmation. If a remote URL resolves to a login or access-denied page, interactive mode stops and offers capture-auth / continue-anyway / switch-to-local-root choices before anything is written.

```bash
interfacectl init [options]
```

Outputs:

- `contracts/generated/<surface>.analysis.json`
- `contracts/generated/<surface>.design-system.draft.json`
- `contracts/generated/<surface>.contract.json`
- `contracts/generated/<surface>.extraction.json`

Default behavior is warn-first. If surface-kind inference is low confidence, interactive mode asks for confirmation and non-interactive mode requires `--surface-kind marketing|application|unknown`.
Non-interactive URL onboarding fails fast on login/access-denied pages unless `--continue-on-gate` is supplied for provisional output.

### `analyze`

Machine-readable first-run analysis for power users. `analyze` uses the same platform-owned heuristics as `init` but only writes the analysis artifact; it does not mutate contracts outside `contracts/generated/<surface>.analysis.json`.

```bash
interfacectl analyze [options]
```

### `auth`

Browser-session profile management for protected remote onboarding. Use `auth capture` to create or refresh a replayable profile, `auth list` to inspect readiness, `auth test --url ...` to verify real authenticated replay, and `auth revoke` / `auth clear` to remove stored state.

```bash
interfacectl auth capture --profile <name> --url <exact-host-url>
interfacectl auth test --profile <name> --url <protected-url>
interfacectl auth list
```

Notes:

- Profiles are exact-host scoped in v1.
- Remote analysis never silently falls back to anonymous access when `--auth-profile` is explicitly supplied.
- Interactive onboarding writes artifacts only after a preview confirmation step.
- If Chromium is missing locally, install it with `pnpm --filter @surfaces/interfacectl-cli exec playwright install chromium`.

### `validate`

Validates configured surfaces against a shared interface contract. Performs comprehensive validation including contract structure validation, surface descriptor collection, and compliance checking for fonts, colors, icon sources, layout, motion, and sections.

```bash
interfacectl validate [options]
```

### `diff`

Compares a contract against observed artifacts and generates a detailed diff. Performs structural comparison showing additions, removals, modifications, and renames with drift risk detection.

```bash
interfacectl diff [options]
```

### `enforce`

Enforces policy on interface contracts using configurable enforcement modes: `fail` (run diff and exit when policy threshold is exceeded), `fix` (automatically apply safe fixes), or `pr` (generate patches for review).

```bash
interfacectl enforce [options]
```

### `compile`

Compiles a validated interface contract into a deterministic, runtime-readable bundle. The bundle includes a manifest, a normalized contract, per-surface files, and per-constraint files for downstream tools to consume.

This command does **not** perform enforcement or runtime gating. It produces a stable artifact intended for inspection, tooling, or future runtime consumption.

```bash
interfacectl compile --contract <path> --out <dir>
```

### `generate-contract` (Phase 0 expert command)

Extracts a **deterministic contract artifact** from a Next.js app by analyzing app code and config. This is **contract extraction only** — no first-run classification, no design-system draft, and no onboarding summary. Prefer `interfacectl init` for the user-facing entry point.

**Phase 0 scope:** Routes (app router), layout shell presence (`app/layout.tsx` or `app/(shell)/layout.tsx`), design system usage (`@surfaces/ui` component imports), and auth posture (`/auth` routes). The command also seeds `color.allowedValues` and web-surface `icons.allowedSources` from observed descriptors (default `icons.policy: "warn"`). Values that cannot be extracted safely are omitted and reported as warnings in the extraction report.

**Phase 0 guardrails:** No Babel or heavy AST frameworks. Extraction uses filesystem walks and regex for determinism, debuggability, and minimal dependency surface. See [docs/plans/phase-0-extraction-guardrails.md](docs/plans/phase-0-extraction-guardrails.md) for what we extract, what we omit, and when AST tooling may be added in a later phase.

Outputs:

- **Contract:** `contracts/generated/<surfaceId>.contract.json` — schema-valid contract with extracted data under `x_extracted`.
- **Report:** `contracts/generated/<surfaceId>.extraction.json` — machine-readable extraction summary and warnings for debugging.

```bash
interfacectl generate-contract --app-root <path> --surface <surfaceId> [--out <path>] [--report-out <path>]
```

Running the command twice produces identical contract and report (stable key order, no timestamps). See [API.md](API.md) for full options.

### `validate-extracted` (Phase 0.5 expert command)

Validates that the **declared policy** (contract `surfaces[].phase0`) matches **extracted reality** (from the extraction report or generated contract). `init` already runs this during onboarding; use the command directly in CI or for focused debugging.

```bash
interfacectl validate-extracted --contract <path> --extracted <path> [--surface <id>] [--format text|json] [--exit-codes v2]
```

Add optional `phase0` to each surface in your policy contract: `authPosture` (public | auth-aware | auth-first), `requiresShell`, `expectsAuthRoutes`, `expectsDesignSystem`. v2 exit codes: 0 success, 10 E0 (load/parse error), 30 E2 (mismatch). See [API.md](API.md#validate-extracted-phase-05) for rules and finding codes.

For complete command documentation with all options, exit codes, and output formats, see [API.md](API.md).

**Generation-time gating:** `interfacectl validate` is the canonical command for contract compliance. Use it to gate changes before merge or deployment. For local use and CI, run validate with your contract path and, for deterministic exit codes, use `--exit-codes v2`. The command `enforce --mode fail` is optional; it runs a structural diff then applies a policy threshold and is useful when you want to block on diff severity separately from compliance.

## Lifecycle overview

interfacectl separates interface governance into clear phases:

- **Validate**  
  Enforces contract compliance at generation time.

- **Diff / Enforce**  
  Detects and classifies drift with traceability (stableId, contractRef, ruleRef).

- **Compile**  
  Produces a deterministic, runtime-readable bundle (manifest, normalized contract, surfaces, constraints) that serves as the handoff point to other tools.

- **Runtime consumption (framing only)**  
  Consumption semantics are documented in Phase 4. No runtime enforcement or loaders exist in this repo.

See:
- `docs/plans/phase-3-compile-directory-bundle.md`
- `docs/plans/phase-4-runtime-consumption-framing.md`

### Lifecycle diagram

```
Design / Generation time
────────────────────────

  Contract
     │
     ▼
  validate
     │
     ▼
  diff / enforce
     │
     ▼
  compile
     │
     ▼
  ┌─────────────────────────────┐
  │ Deterministic bundle         │
  │ - manifest.json              │
  │ - contract.normalized.json   │
  │ - surfaces/*.json            │
  │ - constraints/*.json         │
  └─────────────────────────────┘

Runtime (not implemented here)
──────────────────────────────

  bundle
     │
     ▼
  [consumer]
     │
     ├─ read / reference
     ├─ observe / compare
     └─ explain (future)
```

## Usage Examples

### First run

Analyze and draft a first contract from a local web app:

```bash
interfacectl init --app-root apps/my-app --surface my-app
```

Inspect a public URL without writing a contract:

```bash
interfacectl analyze --url https://example.com --surface example-site
```

Capture a protected app session and analyze the authenticated surface:

```bash
interfacectl auth capture --profile customer-admin --url https://app.example.com/login
interfacectl analyze --url https://app.example.com/dashboard --surface customer-app --auth-profile customer-admin
```

### Validation

Validate all surfaces against a contract:

```bash
interfacectl validate --root . --contract ./contracts/ui.contract.json
```

Validate with JSON output for CI integration:

```bash
interfacectl validate --root . --contract ./contracts/ui.contract.json --format json
```

Validate specific surfaces only:

```bash
interfacectl validate --surface my-surface --surface another-surface
```

### Diff

Compare contract against observed artifacts:

```bash
interfacectl diff --root . --contract ./contracts/ui.contract.json
```

Generate diff with normalization disabled (for debugging):

```bash
interfacectl diff --no-normalize
```

### Enforcement

Fail on violations (useful for CI):

```bash
interfacectl enforce --mode fail
```

Preview automatic fixes:

```bash
interfacectl enforce --mode fix --dry-run
```

Apply automatic fixes:

```bash
interfacectl enforce --mode fix
```

Generate patch for review:

```bash
interfacectl enforce --mode pr --format json --out fix-patch.json
```

## Configuration

### Environment Variables

Configuration options can be set via environment variables:

- `SURFACES_ROOT` — Project root directory (defaults to current working directory)
- `SURFACES_CONTRACT` — Path to contract JSON file (defaults to `contracts/surfaces.web.contract.json`)
- `SURFACES_CONFIG` — Path to interfacectl config JSON file (defaults to `interfacectl.config.json`)
- `INTERFACECTL_EXIT_CODES` — Exit code version (`v1` or `v2`, default: `v1`). Use `v2` in CI for stable category-based exit codes.

**Precedence:** CLI flags > environment variables > defaults

### Config File

Create an `interfacectl.config.json` file in your project root to map surface IDs to their root directories:

```json
{
  "surfaceRoots": {
    "demo-surface": "src/demo-surface",
    "my-app": "apps/my-app"
  }
}
```

The config file tells interfacectl where to find surface descriptors in your codebase. Each key is a surface ID that must match an entry in your contract file.

## CI/CD Integration

**Recommended:** Use `interfacectl validate` with `--exit-codes v2` as the contract compliance gate. Example GitHub Actions workflow:

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 10.26.2
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: pnpm
- run: pnpm install --frozen-lockfile
- run: pnpm exec interfacectl validate --root . --contract contracts/ui.contract.json --format json --exit-codes v2
```

You can set `INTERFACECTL_EXIT_CODES=v2` in the job environment instead of passing `--exit-codes v2` if you prefer.

Optional: to block on structural diff severity (policy-on-diff), run `interfacectl enforce --mode fail` in addition to or instead of validate, depending on your workflow.

## Development

### Building

Build produces `dist/` directories in each package:

```bash
pnpm install
pnpm run build
```

### Testing

Tests assume `dist/` exists and run against built artifacts. Consumers depend only on the CLI interface, not build internals. The tarball-install test validates CLI works from a packaged install.

```bash
pnpm run test
```

## Releasing

1. Run `pnpm changeset` and choose affected packages.
2. Merge the generated changeset.
3. Trigger the **Release** workflow (requires `NPM_TOKEN`) or push a `v*` tag.

The release workflow builds, tests, and publishes packages through Changesets.
