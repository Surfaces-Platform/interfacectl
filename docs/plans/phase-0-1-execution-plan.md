# Phase 0 and Phase 1 Execution Plan

**Status:** Execution plan.

## Purpose and scope

_Approval note:_ This section is approved as written. Scope is intentionally constrained to documentation and alias-level changes to prevent premature expansion.

This document defines the scope of Phase 0 and Phase 1 from docs/plans/contract-first-enforcement-alignment.md. It records the chosen gating workflow, exit code decision, and testable acceptance criteria so implementation PRs can be reviewed against a single source of truth.
Timing terminology follows `docs/taxonomy.md`.

**In scope:** Phase 0 (contract baseline documentation and alignment) and Phase 1 (generation-time gating documentation and optional alias). No new enforcement logic; only documentation and, if chosen, a thin gate command.

**Out of scope for this plan:** Phase 2 (traceability), Phase 3 (runtime compile), Phase 4 (runtime consumption framing). Any code that implements compile or new validation rules is out of scope until a follow-up plan is approved.

---


## Chosen gating option: "validate is the gate" (Option A)

_Approval note:_ Decision is approved. "validate" correctly represents contract compliance, distinct from diff-plus-policy enforcement. Treat "canonical gate" as stable language going forward.

**Decision:** The canonical generation-time gating workflow is **validate**. For local use and CI, the recommended command is `interfacectl validate` with explicit contract and root. No separate `gate` command is required; documentation will state that validate is the gate. No `gate` command will be added in Phase 0 or Phase 1. `validate` remains the only canonical gate during these phases. If a `gate` command is considered later, it must be introduced under a separate approved plan and must be an alias only with no new behavior.

**Reasoning:** Validate is the only command that directly checks contract compliance. It loads the contract, collects surface descriptors from the codebase via static analysis, and runs the validator's `evaluateContractCompliance`. The result answers "do implementations comply with the contract?" with deterministic exit codes. Enforce --mode fail runs diff (contract vs observed structure) then applies policy; it answers a different question ("do structural diffs exceed the policy threshold?") and depends on a policy file. Strategy says "Validate UI produced by designers, systems, or agents" and "Prevent invalid or out-of-bounds output from existing." That aligns with validate, not with diff-plus-policy.

**What we lose by not choosing the other options:**

- **Not choosing B (enforce --mode fail as gate):** We do not make diff-plus-policy the single recommended gate. Teams that want to block on structural diff severity can still run `interfacectl enforce --mode fail` explicitly; it remains documented in API.md and README. We accept that the canonical gate is compliance (validate), and policy-on-diff is an optional second step.

- **Not choosing C (gate wraps one or both):** We do not add a `gate` subcommand. We avoid maintaining an alias and avoid defining what "gate" runs by default. If we later add a `gate` command, it will run validate only (thin wrapper) and will be documented as such.

---

## Recommended commands

**Local use (development):**

```bash
interfacectl validate --root . --contract <path-to-contract> [--surface <id>...] [--format text|json]
```

Use `--format json` when piping or saving output. Use `--surface` to limit to specific surfaces.

**CI use:**

```bash
interfacectl validate --root . --contract <path-to-contract> --exit-codes v2 [--format json]
```

_Review note:_ Environment variable names are intentionally left open in Phase 0 and Phase 1. They must be confirmed and locked before any implementation work begins.

Contract path and root may be set via environment variables supported by interfacectl. Confirm the exact names in code and document only the real ones here. Update this section once env var names are confirmed.

---


## Exit code decision: use v2 in CI

_Approval note:_ Use v2 exit codes as the documentation default even if the binary default remains v1. This avoids future churn and keeps CI behavior deterministic.

**Decision:** For CI and for any new documentation examples, use **v2** exit codes. Set explicitly via `--exit-codes v2` or `INTERFACECTL_EXIT_CODES=v2`.

**Reasoning:** v2 gives stable, category-based exit codes (0, 10, 20, 30) so scripts can distinguish E0 (artifact invalid), E1 (token policy), and E2 (interface contract). v1 uses 0/1/2 and prints a deprecation warning when violations occur. The plan states v2 will become the default in a future major release. Using v2 in CI now avoids churn when the default flips and makes failure handling deterministic.

**Exact flags or env vars:**

- CLI: `--exit-codes v2`
- Environment: `INTERFACECTL_EXIT_CODE_VERSION=v2`

CI workflow examples in README and API.md should show `--exit-codes v2` for validate (and for enforce when documented).

---


## Acceptance criteria (Phase 0 and Phase 1)

_Approval note:_ Acceptance criteria are approved as written. They are testable, scoped, and explicitly prevent early implementation of Phase 2+ features.

**Phase 0 (testable in this repo):**

1. A section or doc exists (in API.md or docs/) that describes the minimal authoritative contract: required fields (contractId, version, surfaces, sections, constraints), optional color policy, and deprecated allowedColors. A reader can identify what the schema requires without reading the JSON schema file alone.
2. The contract schema path and the validation entry point (validateContractStructure, evaluateContractCompliance) are named in documentation so implementors know where contract semantics live.
3. No schema or validator code changes are required for Phase 0 unless they are documentation-only (e.g. comments).

**Phase 1 (testable in this repo):**

1. README or API.md states clearly that **validate** is the recommended command for generation-time gating (local and CI). The exact recommended command for CI includes `--exit-codes v2`.
2. README CI example(s) show `interfacectl validate ... --exit-codes v2` (and optionally `INTERFACECTL_EXIT_CODE_VERSION=v2`).
3. If a `gate` command is added: it is implemented as a thin wrapper that invokes validate with fixed or passed-through options; it does not duplicate validation logic; it is registered in the CLI command registration entry point.
4. Running `interfacectl validate --root . --contract <fixture-contract> --exit-codes v2` from the repo against an existing fixture (e.g. packages/interfacectl-cli/test/fixtures/minimal-project) exits 0 when the fixture is compliant and non-zero when the fixture is non-compliant or missing. Verify this behavior locally and ensure docs and examples match it.

---


## Out of scope (Phase 2 and beyond)

_Guardrail:_ Do not soften or bypass this list. Any work that falls into Phase 2 or beyond requires a separate, approved plan.

The following are explicitly out of scope for Phase 0 and Phase 1:

- Implementing `interfacectl compile` or any runtime bundle output.
- Implementing `interfacectl explain` or a violation code lookup table.
- Adding or changing validation rules, violation types, or contract schema (beyond documentation).
- Adding a CI job in .github/workflows that runs interfacectl (optional follow-up; not part of Phase 1).
- Defining breaking vs non-breaking contract diff classification.
- Changing enforce --mode fail behavior or making it the default gate.
- Any code change in packages/interfacectl-validator except comments or doc-only edits.
- Adding a `gate` command or changing command semantics without an explicitly approved follow-up plan.

---


## Review checklist for implementation PRs

_Review guidance:_ Use this checklist instead of intuition when reviewing PRs. If an item fails, the PR should not merge.

Use this checklist when reviewing PRs that implement Phase 0 or Phase 1:

1. **Plan alignment:** Does the PR only change documentation and/or add a thin gate command? Does it avoid implementing compile, explain, or new validation logic?
2. **Gating:** If documentation was updated, does it state that validate is the recommended gate and show the recommended command(s) for local and CI?
3. **Exit codes:** Do any new or updated CI examples use `--exit-codes v2` (or `INTERFACECTL_EXIT_CODE_VERSION=v2`)?
4. **Phase 0:** If contract documentation was added, does it describe required fields, optional color policy, and deprecated allowedColors? Does it point to the schema and validator entry points?
5. **Phase 1 gate (if applicable):** If a `gate` command was added, does it only call validate (or delegate to validate) with no duplicate compliance logic? Is it registered in the CLI command registration entry point?
6. **Living constraint:** Is the README constraint ("All feature work must align with docs/plans/contract-first-enforcement-alignment.md") still present and unchanged?
