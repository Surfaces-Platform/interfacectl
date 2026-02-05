# interfacectl

Interface contract tooling for the Surfaces ecosystem. Validates, compares, and enforces compliance between defined interface contracts and actual implementation artifacts across multiple surfaces.

## Planning

All feature work must align with docs/plans/contract-first-enforcement-alignment.md.

## Feature planning requirement

Before planning or implementing any feature, read "docs/strategy.md" and produce a short "Feature Plan" that explicitly maps the work to the strategy decision filter and enforcement model.

See "docs/feature-plan.template.md".

This repository contains three packages:

- **`@surfaces/interfacectl-validator`** — Core validation library with TypeScript types, schema validation, and bundled contract schema definitions. Provides the foundation for contract validation.

- **`@surfaces/interfacectl-cli`** — Command-line interface that consumes the validator to run contract checks from any repository. Most users only need this package.

- **`@surfaces/interfacectl-extractor`** — Library that extracts a contract from a Next.js app (Phase 0). Used by the CLI `generate-contract` command. Exports `extractContractFromNextApp({ appRoot, surfaceId })`.

## Requirements

- **Node.js**: >=18.20.0 or >=20.10.0 (required for `with { type: "json" }` import syntax support)
- **pnpm**: 10.26.2 (specified in `packageManager` field)

## Installation

Install the CLI package as a development dependency:

```bash
pnpm add -D @surfaces/interfacectl-cli
```

## Quick Start

After installation, validate your surfaces against a contract:

```bash
interfacectl validate --root . --contract ./contracts/ui.contract.json
```

For detailed command documentation, see [API.md](API.md).

## Commands Overview

The CLI provides four main commands:

### `validate`

Validates configured surfaces against a shared interface contract. Performs comprehensive validation including contract structure validation, surface descriptor collection, and compliance checking for fonts, colors, layout, motion, and sections.

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

### `generate-contract` (Phase 0)

Extracts a **deterministic contract artifact** from a Next.js app by analyzing app code and config. This is **contract extraction only** — no enforcement, no network calls.

**Phase 0 scope:** Routes (app router), layout shell presence (`app/layout.tsx` or `app/(shell)/layout.tsx`), design system usage (`@surfaces/ui` component imports), and auth posture (`/auth` routes). Values that cannot be extracted safely are omitted and reported as warnings in the extraction report.

**Phase 0 guardrails:** No Babel or heavy AST frameworks. Extraction uses filesystem walks and regex for determinism, debuggability, and minimal dependency surface. See [docs/plans/phase-0-extraction-guardrails.md](docs/plans/phase-0-extraction-guardrails.md) for what we extract, what we omit, and when AST tooling may be added in a later phase.

Outputs:

- **Contract:** `contracts/generated/<surfaceId>.contract.json` — schema-valid contract with extracted data under `x_extracted`.
- **Report:** `contracts/generated/<surfaceId>.extraction.json` — machine-readable extraction summary and warnings for debugging.

```bash
interfacectl generate-contract --app-root <path> --surface <surfaceId> [--out <path>] [--report-out <path>]
```

Running the command twice produces identical contract and report (stable key order, no timestamps). See [API.md](API.md) for full options.

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
