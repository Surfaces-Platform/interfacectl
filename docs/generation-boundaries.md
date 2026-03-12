# Generation Boundaries Guide

Goal: prevent generators from emitting shell-owned primitives (e.g., navigation) by enforcing the contract before code lands. The same logic can be reused on edge/on-device generation.

## Signals to use
- `contract.shell.owns`: array of primitives the shell owns globally (e.g., `["navigation"]`).
- `surface.mustNotEmit`: per-surface override of primitives that the surface must not generate. If absent, fall back to `contract.shell.owns`.
- Descriptor primitives: generation (or extraction) should emit `primitives: [{ role, count, sources }]` per surface.

## Required behavior for generators
1) Load the contract.
2) For each surface, compute `banList = surface.mustNotEmit || contract.shell?.owns || []`.
3) Scan the generated output into a descriptor with `primitives`.
4) If any `primitive.role` is in `banList` with `count > 0`, **fail fast** with `shell-owned-primitive-emitted`.

## Reference checker
- Script: `tools/check-generation-boundaries.mjs`
- Usage:
  ```bash
  node tools/check-generation-boundaries.mjs \
    --contract contracts/surfaces.web.contract.json \
    --descriptor out/generated-descriptor.json
  ```
- Exit codes:
  - `0` pass
  - `1` invalid input (missing files/fields)
  - `2` violation detected (details printed)

## Integration points
- **Generation time (local/CI):** run the checker immediately after generation and before writing/committing output. Add it to generator pipelines or pre-commit hooks.
- **CI/CD:** existing `interfacectl validate` already enforces the same rule; keep both for fast feedback.
- **Runtime (edge/on-device):** reuse the same ban list from the compiled manifest and reject adaptations that emit banned primitives.

## Minimal descriptor shape expected by the checker
```json
[
  {
    "surfaceId": "interfacectl-web",
    "primitives": [
      { "role": "navigation", "count": 1, "sources": ["app/(shell)/layout.tsx"] }
    ]
  }
]
```

## Notes
- If both `mustNotEmit` and `shell.owns` are absent, the checker is a no-op for that surface.
- Role naming: use the canonical role string `navigation` for nav bars; if you introduce aliases, normalize them before writing the descriptor.

## Related docs
- [Shell Boundary Semantics](./shell-boundary.md)
- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
