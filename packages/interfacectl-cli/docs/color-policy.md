# Color Policy

`interfacectl` uses one unified color policy model for all color values (CSS vars and literals).

## Contract shape

```json
{
  "color": {
    "policy": "off",
    "allowedValues": [
      "var(--color-bg)",
      "#ffffff",
      "rgba(15,23,42,0.3)"
    ]
  }
}
```

- `policy`: `off | warn | strict`
- `allowedValues`: exact canonical values allowed by contract

This replaces and hard-removes legacy fields:

- `surfaces[*].allowedColors`
- `color.sourceOfTruth`
- `color.rawValues`

## Enforcement behavior

All extracted descriptor colors are compared against `color.allowedValues` using normalized exact string matching.

- `off`: skip color violations
- `warn`: emit warning findings
- `strict`: emit error findings

Violation mapping:

- Validator violation type: `color-not-allowed`
- CLI finding code: `color.disallowed`

CLI finding details include:

- `found`: observed color value
- `expected`: contract `allowedValues`
- `location`: source location when available

## Generation time extraction behavior

Local extraction flows auto-seed from observed source colors:

- `interfacectl generate-contract`
- `interfacectl init --extract-mode local-root`

If no colors are found, generated contracts keep an empty allowlist and emit extraction warnings.

Remote bootstrap flow (`init --extract-mode remote-url`) uses:

- `policy: "warn"`
- `allowedValues: []`

and emits an explicit warning that seeding was not done from code.

## Migration

Use the built-in migrator for hard-cut conversion:

```bash
interfacectl migrate-color-policy --contract contracts/ui.contract.json
```

Optional observed-color union during migration:

```bash
interfacectl migrate-color-policy \
  --contract contracts/ui.contract.json \
  --include-observed \
  --app-root apps/web \
  --surface web
```

Migrator behavior:

- Derives `color.policy` from legacy raw policy when present, else defaults to `warn`
- Builds `allowedValues` from legacy allowlists and per-surface `allowedColors`
- Removes legacy fields
- Normalizes and de-duplicates values
