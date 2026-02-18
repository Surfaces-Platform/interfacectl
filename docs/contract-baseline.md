# Contract baseline

This document defines the minimal authoritative interface contract enforced by `interfacectl`. It is a human-readable baseline; the schema remains the source of truth.

## Required top-level fields

Every contract must include:

- `contractId` (string, non-empty): contract identifier used for traceability.
- `version` (string): semantic version, pattern `X.Y.Z`.
- `surfaces` (array, at least one item): governed surfaces.
- `sections` (array, at least one item): section catalog.
- `constraints` (object): currently requires `motion` with `allowedDurationsMs` and `allowedTimingFunctions`.
- `color` (object): required unified color policy with `policy` and `allowedValues`.

## Per-surface required fields

Each item in `surfaces` must include:

- `id` (string): lowercase alphanumeric and hyphens.
- `displayName` (string, non-empty)
- `type` (`"web"` or `"cli"`)
- `requiredSections` (array of section ids)
- `allowedFonts` (array of strings)
- `layout.maxContentWidth` (number, minimum 1)

Optional surface layout fields:

- `layout.requiredContainers` (array of strings)
- `layout.pageFrame` (when present, enforced by validator)
  - `layout.pageFrame.containerMinWidthPx` (optional): exact deterministic min-width check in px for `[data-contract="page-container"]`.

Optional per-surface icon policy (web surfaces):

- `icons.policy`: one of `"off"`, `"warn"`, `"strict"`.
- `icons.allowedSources`: array of allowed icon source libraries (for example `lucide-react`, `@heroicons/react/24/outline`).

## Section required fields

Each item in `sections` must include:

- `id` (string)
- `intent` (string, non-empty)
- `description` (string, non-empty)

## Required color policy

The top-level `color` object must include:

- `policy`: one of `"off"`, `"warn"`, `"strict"`.
- `allowedValues`: array of exact canonical color values allowed across the contract.

Enforcement semantics:

- `off`: skip color enforcement.
- `warn`: emit warning findings for disallowed values.
- `strict`: emit error findings for disallowed values.

Violation contract:

- Validator violation type: `color-not-allowed`
- CLI finding code: `color.disallowed`

## Web icon source policy (optional)

When `surfaces[*].icons` is present for a web surface:

- `off`: skip icon source enforcement.
- `warn`: emit warning findings for disallowed icon sources.
- `strict`: emit error findings for disallowed icon sources.

Violation contract:

- Validator violation type: `icon-source-not-allowed`
- CLI finding code: `icon.source-disallowed`

## Shell ownership boundary (optional)

When a shell owns global primitives:

- Top-level `shell.owns`: shell-owned primitives (`nav`, `header`, `sidebar`, etc.).
- Per-surface `mustNotEmit`: explicit surface bans. If omitted, generators/validators can default to `shell.owns`.

## Removed legacy fields (hard break)

The following legacy fields are not accepted by the active schema:

- `surfaces[*].allowedColors`
- `color.sourceOfTruth`
- `color.rawValues`

For migration, use:

```bash
interfacectl migrate-color-policy --contract <path>
```

## Where contract semantics live in the repo

- Schema: `packages/interfacectl-validator/src/schema/web.surface.contract.schema.json`
- Structure validation: `validateContractStructure` in `packages/interfacectl-validator/src/index.ts`
- Compliance evaluation: `evaluateContractCompliance` in `packages/interfacectl-validator/src/index.ts`
- CLI validate command: `packages/interfacectl-cli/src/commands/validate.ts`
- Descriptor extraction: `packages/interfacectl-cli/src/descriptors/static-analysis.ts`
