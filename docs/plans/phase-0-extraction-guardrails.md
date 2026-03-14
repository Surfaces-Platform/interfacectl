# Phase 0 Extraction Guardrails

**Status:** Framing doc.

**Scope:** Contract extraction from Next.js app code (`interfacectl generate-contract`). Phase-scoped and revisitable.

## How extraction works

- **Input:** Next.js app directory (contains `app/`).
- **Method:** Filesystem walk + regex. No JSX, TypeScript, or CSS parsing.
- **Output:**
  - `contracts/generated/<surface>.contract.json` — schema-valid contract with extracted facts under `x_extracted`.
  - `contracts/generated/<surface>.extraction.json` — machine-readable extraction report and warnings.
- **Validation:** `validate-extracted` compares policy expectations (`surfaces[].phase0` in the policy contract) to extracted reality and fails CI on mismatch.

---

## No heavy AST in Phase 0

We avoid Babel, TypeScript compiler API, or other full AST frameworks in Phase 0 for:

- **Determinism** — Filesystem walks and regex are predictable; AST tooling can vary by version and config.
- **Debuggability** — Extraction logic is easy to trace; failures map directly to file paths and patterns.
- **Minimal dependency surface** — No parser or transpiler deps; faster installs and fewer version skew risks.

---

## What we extract (Phase 0)

| Signal | Method |
|-------|--------|
| Routes | `readdir` over `app/`; page.tsx, route.ts patterns |
| Layout shell | `access()` for `app/layout.tsx`, `app/(shell)/layout.tsx` |
| Design system usage | Regex scan for `@surfaces/ui` imports in .tsx/.ts/.jsx/.js |
| Auth posture | `access()` for `app/auth/` directory |

---

## What we do not extract (Phase 0)

- JSX structure, component trees, or props
- Section IDs from `data-contract-section` or similar
- Fonts, colors, or layout values from CSS/JS
- Dynamic route params or middleware

These require full parsing. Omit and emit a warning in the extraction report.

---

## When to add AST tooling

Add Babel, ts-morph, or similar **only when**:

1. A concrete extraction requirement is approved (e.g. "extract section IDs from data attributes").
2. Regex or filesystem-based extraction demonstrably fails for that requirement.
3. A follow-up plan documents the new dependency and determinism guarantees.

This is a default, not a block. Later phases may introduce AST-based extraction under a separate plan.
