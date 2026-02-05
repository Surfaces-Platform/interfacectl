# Contract baseline

This document defines the minimal authoritative interface contract enforced by interfacectl. It exists so builders can understand what a valid contract must declare without reading the JSON schema file directly. This document describes intent and requirements. The schema remains the source of truth.

## Required top-level fields

Every contract must include:

- **contractId** (string, non-empty): Identifier for the contract. Used for traceability.
- **version** (string): Semantic version of the contract. Must match the pattern `X.Y.Z` (for example, `1.0.0`). Used to track compatibility over time.
- **surfaces** (array, at least one item): List of surfaces (apps or UIs) that the contract governs. Each surface has its own required and allowed values.
- **sections** (array, at least one item): List of sections that surfaces can implement. Each section has an id, intent, and description.
- **constraints** (object): Global constraints. At present, the only required constraint is **motion**, defined as an object with **allowedDurationsMs** (array of integers, milliseconds) and **allowedTimingFunctions** (array of strings). Additional constraint categories may be added in future schema versions.

## Per-surface required fields

Each entry in **surfaces** must have:

- **id** (string): Lowercase alphanumeric and hyphens only. Must match the key used in `interfacectl.config.json` surfaceRoots.
- **displayName** (string, non-empty): Human-readable name.
- **type** (string): Either `"web"` or `"cli"`.
- **requiredSections** (array): Section ids that this surface must implement. Section id pattern: `a-z0-9` and dots (e.g. `main.hero`).
- **allowedFonts** (array, at least one string): Font family values that the surface may use. Implementations are checked against this list. This list is enforced during compliance evaluation.
- **layout** (object): Must include **maxContentWidth** (number, minimum 1). Optional fields include **requiredContainers** (array of strings) and **pageFrame**. When present, **pageFrame** is enforced according to the contract definition.

## Per-section required fields

Each entry in **sections** must have:

- **id** (string): Matches the pattern used in surface requiredSections.
- **intent** (string, non-empty): Purpose of the section. Documented for clarity. Not currently used as an enforcement input.
- **description** (string, non-empty): Human-readable description.

## Optional: color policy

The top-level **color** object is optional. When present it can include:

- **sourceOfTruth**: If `type` is `"tokens"`, you must provide **tokenNamespaces** (array of strings). Used to allow or disallow CSS variable namespaces for colors.
- **rawValues**: **policy** is required (`"off"`, `"warn"`, or `"strict"`). Optional **allowlist** and **denylist** arrays of color values. Controls whether raw color literals (hex, rgb, hsl) are permitted.
- **semantics**: Optional **roles** (accent, text, background, border) each with **enforcement** (`"off"`, `"warn"`, `"strict"`).
- **consistency**: Optional **acrossSurfaces** object with **enforcement** level and **signals** used for reporting.

## Deprecated fields

- **allowedColors** (per-surface): Deprecated. The schema still accepts it for compatibility. Prefer the top-level **color** policy with **sourceOfTruth** and **rawValues**. Migration: move per-surface color allowlists into **color.sourceOfTruth** (e.g. token namespaces) or **color.rawValues** (allowlist/denylist). The CLI emits a deprecation warning when allowedColors is present. Deprecated fields are accepted for compatibility but may be removed in a future major version.

## Where contract semantics live in the repo

- **Schema file:** `packages/interfacectl-validator/src/schema/surfaces.web.contract.schema.json`. This is the authoritative JSON Schema. The CLI uses a bundled copy of this schema by default. You may override it with `--schema <path>` if needed.
- **Structure validation:** The function **validateContractStructure** in `packages/interfacectl-validator/src/index.ts` loads the schema and validates contract JSON (via AJV). It returns errors or the parsed contract.
- **Compliance evaluation:** The function **evaluateContractCompliance** in the same file takes a validated contract and a list of surface descriptors. It returns a validation summary with per-surface reports and violations. Compliance rules for fonts, colors, layout, motion, sections, and pageFrame are implemented in **evaluateSurfaceCompliance** in the same file.
- **CLI entry point:** The validate command is implemented in `packages/interfacectl-cli/src/commands/validate.ts`. It calls **collectSurfaceDescriptors** (in `packages/interfacectl-cli/src/descriptors/static-analysis.ts`) to gather descriptors from the codebase, then passes the contract and descriptors to **evaluateContractCompliance**. The CLI maps violation types to stable codes in this command implementation.
