# Color Policy

The color policy section provides a flexible, evolution-friendly way to enforce color usage across surfaces. It replaces the deprecated `allowedColors` field on individual surfaces with a centralized policy that supports static analysis.

## Overview

The color policy is required at the contract level and applies to all surfaces. Contracts must include `color.sourceOfTruth` and `color.rawValues`. It consists of four main sections:

- **`sourceOfTruth`**: Defines where colors should come from (tokens vs. none)
- **`rawValues`**: Controls detection and enforcement of raw color literals (hex, rgb, hsl)
- **`semantics`**: (Future) Semantic role enforcement (accent, text, background, border)
- **`consistency`**: (Future) Cross-surface consistency checks

## Migration from `allowedColors`

The `allowedColors` field on surfaces is **deprecated** and accepted only during a one-release compatibility window. Migrate to the required color policy:

### Before (Deprecated)

```json
{
  "surfaces": [
    {
      "id": "web-app",
      "allowedColors": ["var(--color-primary)", "var(--color-secondary)"]
    }
  ]
}
```

### After (Recommended)

```json
{
  "color": {
    "sourceOfTruth": {
      "type": "tokens",
      "tokenNamespaces": ["--color-"]
    },
    "rawValues": {
      "policy": "warn"
    }
  },
  "surfaces": [
    {
      "id": "web-app"
    }
  ]
}
```

When `allowedColors` is present, interfacectl emits a deprecation warning (`contract.deprecated-field`) but does not fail validation during the compatibility window. The warning includes a JSON pointer to the deprecated field and guidance on migration.

## Configuration

The following two blocks are required in contracts:

- `color.sourceOfTruth`
- `color.rawValues`

### `sourceOfTruth`

Defines the authoritative source for colors.

```json
{
  "sourceOfTruth": {
    "type": "tokens" | "none",
    "tokenNamespaces": ["--color-", "--ds-color-"]  // Required if type is "tokens"
  }
}
```

- **`type: "tokens"`**: Colors must come from CSS variables (design tokens). Requires `tokenNamespaces`.
- **`type: "none"`**: No source-of-truth enforcement (useful for gradual migration).

**Token Namespace Validation**: When `type` is `"tokens"`, interfacectl validates that all CSS variable references start with one of the configured namespaces. Variables that don't match trigger `color.token.namespace.violation`.

Example violation:
- Contract: `tokenNamespaces: ["--color-"]`
- Code: `var(--custom-red)` → Violation (doesn't start with `--color-`)
- Code: `var(--color-primary)` → ✅ Valid

### `rawValues`

Controls detection and enforcement of raw color literals (hex, rgb, hsl, hsla).

```json
{
  "rawValues": {
    "policy": "off" | "warn" | "strict",
    "allowlist": ["#ffffff", "#000000"],  // Optional
    "denylist": ["#ff0000"]               // Optional
  }
}
```

**Policy Levels:**
- **`"off"`**: No raw literal detection (except denylist violations)
- **`"warn"`**: Emit warnings for raw literals (does not fail validation)
- **`"strict"`**: Emit errors for raw literals (fails validation with exit code 1)

**Allowlist & Denylist:**
- **Allowlist**: Raw literals that are explicitly permitted (e.g., `#ffffff`, `#000000` for base colors)
- **Denylist**: Raw literals that are always forbidden, regardless of policy level

**Detection:**
- Hex colors: `#rgb`, `#rrggbb`, `#rrggbbaa`
- RGB/RGBA: `rgb(...)`, `rgba(...)`
- HSL/HSLA: `hsl(...)`, `hsla(...)`
- CSS variables (`var(--...)`) are **not** considered raw literals

**Example:**
```json
{
  "rawValues": {
    "policy": "warn",
    "allowlist": ["#ffffff", "#000000"],
    "denylist": ["#ff0000"]
  }
}
```

- `#ff00aa` → Warning (not allowlisted)
- `#ffffff` → ✅ Allowed (in allowlist)
- `#ff0000` → Violation (in denylist, even if allowlisted)

### `semantics` (Future)

Semantic role enforcement for colors. Not yet enforced in v1, but schema accepts the structure for future use.

```json
{
  "semantics": {
    "roles": {
      "accent": { "enforcement": "warn" },
      "text": { "enforcement": "strict" },
      "background": { "enforcement": "warn" },
      "border": { "enforcement": "off" }
    }
  }
}
```

### `consistency` (Future)

Cross-surface consistency checks. Not yet enforced in v1, but schema accepts the structure for future use.

```json
{
  "consistency": {
    "acrossSurfaces": {
      "enforcement": "warn",
      "signals": ["token-name", "css-var-name", "class-fragment"]
    }
  }
}
```

## Validation Codes

### `color.raw-value.used`

Emitted when a raw color literal is detected and violates the policy.

- **Severity**: `warn` or `error` (based on `rawValues.policy`)
- **Category**: `E1` (Token Policy)
- **Details**:
  - `colorValue`: The detected raw literal
  - `source`: File location (if available)
  - `policy`: The policy level (`warn` or `strict`)
  - `jsonPointer`: `/color/rawValues`

**Example:**
```json
{
  "code": "color.raw-value.used",
  "severity": "warn",
  "category": "E1",
  "message": "Raw color literal \"#ff00aa\" detected. Use design tokens instead.",
  "location": "app/globals.css",
  "found": "#ff00aa"
}
```

### `color.token.namespace.violation`

Emitted when a CSS variable doesn't start with any allowed namespace.

- **Severity**: `warn` (default)
- **Category**: `E1` (Token Policy)
- **Details**:
  - `tokenName`: The variable name (e.g., `--not-allowed-token`)
  - `allowedNamespaces`: Array of allowed namespace prefixes
  - `source`: File location (if available)
  - `jsonPointer`: `/color/sourceOfTruth/tokenNamespaces`

**Example:**
```json
{
  "code": "color.token.namespace.violation",
  "severity": "warn",
  "category": "E1",
  "message": "Color token \"--not-allowed-token\" does not start with any allowed namespace. Allowed namespaces: --color-, --ds-color-.",
  "location": "app/components/Button.tsx",
  "found": "--not-allowed-token",
  "expected": ["--color-", "--ds-color-"]
}
```

### `contract.deprecated-field`

Emitted when `allowedColors` is present on a surface.

- **Severity**: `warning`
- **Category**: `E0` (Artifact Invalid)
- **Details**:
  - `field`: `"allowedColors"`
  - `location`: JSON pointer to the field (e.g., `/surfaces/0/allowedColors`)
  - `replacement`: `["color.sourceOfTruth", "color.rawValues"]`

**Example:**
```json
{
  "code": "contract.deprecated-field",
  "severity": "warning",
  "category": "E0",
  "message": "allowedColors is deprecated. Migrate to color.sourceOfTruth + color.rawValues policy.",
  "location": "/surfaces/0/allowedColors"
}
```

## Static Analysis

v1 color validation uses static analysis to extract colors from:

- CSS files (`.css`)
- Inline styles in component files (`.tsx`, `.jsx`, `.ts`, `.js`)
- CSS variable references (`var(--...)`)
- Raw color literals in CSS declarations

**Limitations:**
- Does not validate runtime computed colors
- Does not parse complex CSS expressions (gradients, calc, etc.)
- Conservative detection to avoid false positives

## Best Practices

1. **Start with `warn`**: Use `policy: "warn"` initially to identify raw literals without blocking builds
2. **Use allowlists sparingly**: Only allowlist truly necessary base colors (e.g., `#ffffff`, `#000000`)
3. **Denylist dangerous colors**: Use denylist to explicitly forbid problematic colors
4. **Namespace tokens consistently**: Use a single namespace prefix (e.g., `--color-`) for all design tokens
5. **Migrate gradually**: Keep `allowedColors` during migration, then remove once all surfaces use tokens

## Example Contract

```json
{
  "contractId": "ui.contract",
  "version": "1.0.0",
  "color": {
    "sourceOfTruth": {
      "type": "tokens",
      "tokenNamespaces": ["--color-"]
    },
    "rawValues": {
      "policy": "warn",
      "allowlist": ["#ffffff", "#000000"],
      "denylist": []
    }
  },
  "surfaces": [
    {
      "id": "web-app",
      "displayName": "Web App",
      "type": "web",
      "requiredSections": ["header"],
      "allowedFonts": ["var(--font-primary)"],
      "layout": {
        "maxContentWidth": 1200
      }
    }
  ],
  "sections": [
    {
      "id": "header",
      "intent": "Page header",
      "description": "Main header section"
    }
  ],
  "constraints": {
    "motion": {
      "allowedDurationsMs": [200, 300],
      "allowedTimingFunctions": ["ease", "ease-in-out"]
    }
  }
}
```
