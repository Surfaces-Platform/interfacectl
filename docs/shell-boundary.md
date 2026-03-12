# Shell Boundary Semantics

This page defines the generator-facing shell ownership rules that prevent surface code from emitting shell-owned primitives.

The normative checker behavior remains in [Generation Boundaries Guide](./generation-boundaries.md). This page explains how generators should consume the same semantics.

## Canonical signals

- `contract.shell.owns`: global shell-owned primitives
- `surface.mustNotEmit`: per-surface override for banned primitives
- `shell.contentSlot`: the place where surface-owned content is expected to mount
- descriptor `primitives`: emitted roles, counts, and sources for generated output

If `surface.mustNotEmit` is missing, generators should fall back to `contract.shell.owns`.

## Required generator behavior

1. Load the contract.
2. Compute `banList = surface.mustNotEmit || contract.shell?.owns || []`.
3. Generate only inside the surface-owned content slot or boundary.
4. Convert generated output into descriptor primitives.
5. Fail fast with `shell-owned-primitive-emitted` if any banned primitive is emitted.

## Tool patterns

### Figma Make and other frame-based builders

- lock or reserve shell-owned frames
- expose only the content slot for generation
- emit descriptor primitives for anything the builder still creates

### Agentic coders and template engines

- ban shell-owned imports or components from generated output
- keep shell/layout files out of the writable scope for the surface change
- run generation guard checks before code is committed or promoted

### Hosted descriptor-first tools

- normalize generated output into descriptor primitives
- treat shell-boundary findings as hard generation-time stops
- keep a workspace validation fallback in CI/CD

## Why this matters

The shell boundary is the earliest reliable place to prevent duplicate navigation, duplicate auth wrappers, and other chrome re-emission failures. Generators should use it as a generation-time constraint, not only as a later validation failure.

## Related docs

- [Generation Boundaries Guide](./generation-boundaries.md)
- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
