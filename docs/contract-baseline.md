# Contract baseline

This document describes the minimal authoritative interface contract used by interfacectl. It lets you understand what the contract requires without reading the JSON schema file alone. For the exact schema, see the schema location below.

## Required top-level fields

Every contract must include:

- **contractId** (string, non-empty): Identifier for the contract. Used for traceability.
- **version** (string): Semantic version. Must match the pattern `X.Y.Z` (e.g. `1.0.0`).
- **surfaces** (array, at least one item): List of surfaces (apps or UIs) that the contract governs. Each surface has its own required and allowed values.
- **sections** (array, at least one item): List of sections that surfaces can implement. Each section has an id, intent, and description.
- **constraints** (object): Global constraints. Today the only required part is **motion**: an object with **allowedDurationsMs** (array of integers, milliseconds) and **allowedTimingFunctions** (array of strings).

## Per-surface required fields

Each entry in **surfaces** must have:

- **id** (string): Lowercase alphanumeric and hyphens only. Must match the key used in `interfacectl.config.json` surfaceRoots.
- **displayName** (string, non-empty): Human-readable name.
- **type** (string): Either `"web"` or `"cli"`.
- **requiredSections** (array): Section ids that this surface must implement. Section id pattern: `a-z0-9` and dots (e.g. `main.hero`).
- **allowedFonts** (array, at least one string): Font family values that the surface may use. Implementations are checked against this list.
- **layout** (object): Must include **maxContentWidth** (number, minimum 1). Optionally **requiredContainers** (array of strings) and **pageFrame** (containerSelector, containerMaxWidthPx, paddingXpx, and optional alignment and enforcement).

## Per-section required fields

Each entry in **sections** must have:

- **id** (string): Matches the pattern used in surface requiredSections.
- **intent** (string, non-empty): Purpose of the section. Not yet used as an enforcement hook; documented for clarity.
- **description** (string, non-empty): Human-readable description.

## Optional: color policy

The top-level **color** object is optional. When present it can include:

- **sourceOfTruth**: If `type` is `"tokens"`, you must provide **tokenNamespaces** (array of strings). Used to allow or disallow CSS variable namespaces for colors.
- **rawValues**: **policy** is required (`"off"`, `"warn"`, or `"strict"`). Optional **allowlist** and **denylist** arrays of color values. Controls whether raw color literals (hex, rgb, hsl) are allowed.
- **semantics**: Optional **roles** (accent, text, background, border) each with **enforcement** (`"off"`, `"warn"`, `"strict"`).
- **consistency**: Optional **acrossSurfaces** with **enforcement** and **signals**.

## Deprecated fields

- **allowedColors** (per-surface): Deprecated. The schema still accepts it for compatibility. Prefer the top-level **color** policy with **sourceOfTruth** and **rawValues**. Migration: move per-surface color allowlists into **color.sourceOfTruth** (e.g. token namespaces) or **color.rawValues** (allowlist/denylist). The CLI emits a deprecation warning when allowedColors is present.

## Where contract semantics live in the repo

- **Schema file:** `packages/interfacectl-validator/src/schema/surfaces.web.contract.schema.json`. This is the authoritative JSON Schema. The CLI uses a bundled copy; you can override with `--schema <path>`.
- **Structure validation:** The function **validateContractStructure** in `packages/interfacectl-validator/src/index.ts` loads the schema and validates contract JSON (via AJV). It returns errors or the parsed contract.
- **Compliance evaluation:** The function **evaluateContractCompliance** in the same file takes a validated contract and a list of surface descriptors. It returns a validation summary with per-surface reports and violations. Compliance rules (fonts, colors, layout, motion, sections, pageFrame) are implemented in **evaluateSurfaceCompliance** in that file.
- **CLI entry point:** The validate command is implemented in `packages/interfacectl-cli/src/commands/validate.ts`. It calls **collectSurfaceDescriptors** (in `packages/interfacectl-cli/src/descriptors/static-analysis.ts`) to gather descriptors from the codebase, then passes the contract and descriptors to **evaluateContractCompliance**. The CLI maps violation types to stable codes (e.g. `font.disallowed`) in that command file.
