# Generator-Aware Contract Consumption

This document defines how generators should consume interface contracts to improve generation accuracy before code lands and to correct output when it drifts.

## Use the contract twice

Generators should use the contract in two loops:

1. **Before generation** to constrain structure, layout, tokens, and boundaries.
2. **After generation** to evaluate the produced output and feed structured findings back into the next attempt.

Using only the second loop turns the contract into a post-hoc blocker. Using both loops makes it an authoring aid.

## Contract fields that matter at generation time

### Boundary and ownership

- `shell.owns`
- `shell.contentSlot`
- `surface.mustNotEmit`

These fields define what the generator must leave to the shell and where the surface-owned content is allowed to live.

### Structure and composition

- `sections[*].id`
- `sections[*].intent`
- `surfaces[*].requiredSections`
- `surfaces[*].layout.landingPattern`
- `surfaces[*].flows`

These fields tell the generator which sections must exist, what order or grouping rules apply, and which flows or steps are required.

### Layout constraints

- `surfaces[*].layout.maxContentWidth`
- `surfaces[*].layout.requiredContainers`
- `surfaces[*].layout.pageFrame`
- `surfaces[*].layout.chromePolicy`
- `marketingProfiles.layout`

These fields constrain page width, container shape, frame rules, and shared marketing layout expectations.

### Visual system constraints

- `color.policy`
- `color.allowedValues`
- `surfaces[*].icons.policy`
- `surfaces[*].icons.allowedSources`
- `constraints.motion.allowedDurationsMs`
- `constraints.motion.allowedTimingFunctions`
- `marketingProfiles.typography`
- `surfaces[*].marketingTypographyProfile`
- `surfaces[*].marketingTypographyPolicy`

These fields constrain the palette, icon sources, motion behavior, and shared typography/layout profiles.

## Generator workflow

1. Load the contract and narrow to the target surface.
2. Convert contract fields into prompt instructions, generation config, or locked UI regions.
3. Generate only inside the surface-owned boundary.
4. Emit provenance such as `surfaceId`, `contractId`, and `contract version`.
5. Convert the result into a descriptor or validate directly against the workspace.
6. Feed structured findings back into the next generation attempt.

## Findings are generation input

Generators should not treat findings as human-only diagnostics.

- `shell-owned-primitive-emitted` means the next attempt must stay inside the surface boundary.
- `color.disallowed` means the next attempt must restrict itself to the allowlist.
- `icon.source-disallowed` means the next attempt must pick an allowed icon library.
- layout, landing-pattern, typography, and flow findings should be translated into concrete repair instructions for the next attempt.

## Provenance expectations

Generated output should carry enough provenance for later inspection:

- `surfaceId`
- `contractId`
- `contract version`

Embedding patterns vary by consumer, but the goal is consistent traceability from generated output back to the contract that shaped it.

## Limits of the current contract

The current contract is strongest at correctness constraints and boundary enforcement. Consumer repos may add richer authoring metadata for higher-fidelity first-pass generation, but generators should treat the canonical contract fields above as the minimum interoperable source of truth.

## Related docs

- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [AI Generator Adapter API](./ai-generator-adapter-api.md)
- [Shell Boundary Semantics](./shell-boundary.md)
