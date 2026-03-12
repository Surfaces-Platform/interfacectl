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
- `tokens` (object, optional): allowlisted UI token categories for typography, layout, and motion.

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
- `layout.chromePolicy` (when present, enforced by validator)
  - Shared `generate-contract` can seed this conservatively from portable contract markers.

### Portable chrome extraction

Portable chrome extraction is opt-in and deterministic. Shared `interfacectl` only observes actual elements carrying contract-aware markers; it does not infer wrapper intent from generic DOM structure.

- Use `.contract-container` on governed layout containers. This is the recommended portable `layout-container` signal.
- Use top-level `data-contract-section="<id>"` wrappers for governed sections. Nested sections do not count toward chrome extraction.
- Use `data-contract="page-container"` only when the repo wants explicit page-frame semantics. It remains optional.
- `data-contract-container` remains supported for backward compatibility, but `.contract-container` is the recommended path for new adopters.
- Dynamic radius/shadow values, unresolved custom properties, and runtime-only expressions are treated as ambiguous and will suppress generated `chromePolicy` seeding.

Optional per-surface icon policy (web surfaces):

- `icons.policy`: one of `"off"`, `"warn"`, `"strict"`.
- `icons.allowedSources`: array of allowed icon source libraries (for example `lucide-react`, `@heroicons/react/24/outline`).

Optional top-level UI token policies:

- `tokens.typography`: allowlisted font and type-scale tokens used in font-family, font-size, line-height, and letter-spacing declarations.
- `tokens.layout`: allowlisted spacing, width, sizing, and radius tokens used in layout declarations.
- `tokens.motion`: allowlisted duration and easing tokens used in transition and animation declarations.
- `tokens.<category>.allowedTokens`: canonical token refs used for enforcement.
- `tokens.<category>.tokenMetadata` (optional): generated metadata for canonical tokens, including normalized values, observed attributes, and collapsed aliases.

## Section required fields

Each item in `sections` must include:

- `id` (string)
- `intent` (string, non-empty)
- `description` (string, non-empty)

Optional authoring metadata for web surfaces:

- `components[]`: reusable component library for agentic generation and adaptation.
- `sections[*].anatomy`: generic section pattern, allowed/default components, and section-local slots.
- `sections[*].editPolicy`: safe mutation boundary such as `locked`, `slot-bound`, or `freeform`.
- `sections[*].responsive`: named viewport rules for layout intent and slot reflow.
- `surfaces[*].viewports`: named breakpoint profiles with min/max widths.
- `surfaces[*].authoring`: implementation preferences and source precedence across contract, Figma, code, stories, and live URLs.

These fields are advisory-first in v1. `interfacectl validate` checks structure and referential integrity, but they do not add new compliance violations on their own beyond malformed metadata.

For generator consumption order and end-to-end examples, see `docs/authoring-contracts.md`.

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
