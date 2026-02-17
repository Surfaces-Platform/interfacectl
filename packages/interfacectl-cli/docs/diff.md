# interfacectl diff

The `diff` command compares an interface contract against observed artifacts (descriptors) and reports differences.

## Usage

```bash
interfacectl diff [options]
```

## Options

- `--contract <path>`: Contract JSON path (defaults to `contracts/surfaces.web.contract.json`)
- `--root <path>`: Workspace root (defaults to current working directory)
- `--config <path>`: Config file path (defaults to `interfacectl.config.json`)
- `--surface <id...>`: Filter to specific surfaces
- `--format <text|json>`: Output format (default: `text`)
- `--out <path>`: Write output to file
- `--no-normalize`: Disable normalization (for debugging)
- `--rename-threshold <0-1>`: Rename detection threshold (default: 0.8)
- `--policy <path>`: Optional policy path (for policy metadata in output)

## Normalization

The diff command applies normalization to suppress noise:

1. **Set-like fields**: Arrays like `allowedFonts`, `color.allowedValues`, and `requiredSections` are sorted for comparison (order doesn't matter)
2. **Ephemeral fields**: Fields like `source`, `timestamp`, `buildId` are stripped from observed artifacts
3. **Normalization metadata**: The output includes metadata about what was normalized

## Classification Types

Each diff entry is classified as one of:

- **added**: Present in observed artifact, missing in contract requirement
- **removed**: Required in contract, missing in observed artifact
- **modified**: Same path, different value
- **renamed**: Similarity match above threshold (e.g., section ID changes)

## Output Format

### Text Output

Human-readable grouped output showing:
- Summary of changes (by type and severity)
- Normalization metadata
- Diff entries grouped by surface
- Drift risks (if detected)

### JSON Output

Structured JSON output conforming to `interfacectl.diff.schema.json`:
- `schemaVersion`: Version of output schema
- `tool`: Tool name and version
- `contract`: Contract path and version
- `observed`: Observed root path
- `normalization`: Normalization metadata
- `summary`: Change counts by type and severity
- `entries`: Array of diff entries (sorted deterministically)
- `driftRisks`: Optional array of drift risk signals
- `repro`: Local reproduction command

## Schema Versioning

The output schema is versioned (currently `1.0.0`). Breaking changes require a version bump.

## Exit Codes

- `0`: No diffs found
- `1`: Diffs exist
- `2`: Configuration/usage error
- `3`: Internal error

## Examples

```bash
# Basic diff
interfacectl diff --contract contracts/ui.contract.json

# JSON output
interfacectl diff --format json --out diff.json

# Filter to specific surface
interfacectl diff --surface interfacectl-web
```
