# Web Icon Contract Increment Status

## Status
This increment is feature complete for warn-first rollout.

## Scope in this increment
- Per-surface web icon source policy definition for web surfaces.
- End-to-end warn-mode implementation across extraction, validation, diff, normalization, and compile.
- Integration framing for downstream consumers at CI/CD time.

## Completed in this increment
- `generate-contract` seeds web-surface `icons` policy from observed icon source imports.
- `validate` emits `icon.source-disallowed` findings with policy-driven severity (`warn` non-blocking, `strict` blocking).
- `diff` includes icon-source drift entries at `surfaces/<surfaceId>/icons.allowedSources`.
- Normalize/compile paths preserve deterministic icon policy payloads.
- Core docs and tests are aligned to the icon policy contract.

## Deferred intentionally
- Strict-mode rollout across canonical consumer contracts.
- Runtime (edge) icon-source enforcement.
- Governance/workflow automation beyond contract validation signals.
