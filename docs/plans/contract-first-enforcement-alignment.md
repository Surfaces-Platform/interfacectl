# Feature Plan  
Interfacectl — Contract-First Enforcement Alignment

**Status:** Execution plan (parent).

## Document scope

This plan defines phases for the interfacectl CLI and its artifacts only.
It governs contract schema, validation, enforcement semantics, and compile output.
UI behavior, human actionability, and operational workflows are out of scope.
Downstream consumers may define their own phased lifecycles independently.
Timing terminology in this document follows `docs/taxonomy.md`.

---

## Summary  
Evolve interfacectl into a contract-first enforcement CLI that gates agent-driven interface changes at generation time and produces runtime-consumable enforcement artifacts. The repo already provides deterministic contract validation (`validate`), contract-vs-observed diff (`diff`), and policy-based enforcement (`enforce` with fail/fix/pr). Missing pieces: a single gating workflow that teams can adopt (e.g. `gate` or a clear recommendation) and runtime bundle compilation (`compile`). Violation explainability is deferred to Phase 5. The plan aligns existing behavior with the strategy and adds only what is needed for contract-first gating and runtime consumption. Interfacectl does not generate UI, act as a linter without contracts, or function as an observability tool.

---

## Strategy Alignment  

This feature strengthens the Surfaces decision filter sentence by making it executable in developer workflows.

Decision filter sentence:  
"When an agent proposes a change to the user experience, Surfaces determines whether that change is allowed, under what conditions it may proceed, and blocks or corrects it if it violates intent."

Interfacectl enforces this by:
- validating contracts that define intent and invariants,
- gating proposed changes during development and CI,
- producing deterministic outputs that runtime systems can enforce without reinterpretation.

---

## Contract Impact  

### 1. Contract definition  
The authoritative contract schema lives in `packages/interfacectl-validator/src/schema/web.surface.contract.schema.json`. Contracts are JSON files (default path `contracts/surfaces.web.contract.json` or `SURFACES_CONTRACT`). The schema already includes:
- **Version and scope:** `contractId`, `version` (semver pattern).
- **Surfaces:** per-surface `requiredSections`, `allowedFonts`, `layout` (maxContentWidth, requiredContainers, optional pageFrame), deprecated `allowedColors`.
- **Sections:** `id`, `intent`, `description` (intent is present but not yet a first-class enforcement hook).
- **Constraints:** global `motion` (allowedDurationsMs, allowedTimingFunctions).
- **Color policy:** optional `color` (sourceOfTruth, rawValues, semantics, consistency).

Missing or implicit today:
- No explicit "allowed change surface" or "contextual conditions" as top-level contract concepts; they are implied by surfaces and sections.
- Contract changes are not yet classified as breaking vs non-breaking; diff entries have severity but no formal breaking classification.

Migration: `allowedColors` is deprecated in favor of `color.sourceOfTruth` and `color.rawValues`; existing contracts may need a one-time migration. New schema fields should remain additive where possible.

### 2. Enforcement timing  
- **Generation time:** Contract-aware generators can use contracts to constrain authored output. This plan does not define generator implementations.
- **CI/CD time:** Today gating is achieved by running `interfacectl validate` or `interfacectl enforce --mode fail` in development/pipeline contexts. Validate checks contract compliance against descriptors collected from the codebase; enforce fail runs diff then evaluates against policy. CI does not yet run interfacectl; adding a step is repo-specific.
- **Runtime (edge):** No compiled bundles yet. `interfacectl compile` (or equivalent) does not exist; runtime consumers would need a defined bundle format and output location.

### 3. Violation handling  
- Violations are reported and, when used as a gate, cause non-zero exit codes (v1: 1/2; v2: 10/20/30 by category).
- Each violation already has a stable code (e.g. `font.disallowed`, `section.missing`) and maps to a category (E0/E1/E2). The validator emits `DriftViolation` with `type`, `message`, and optional `details` (including `jsonPointer` for some checks).
- There is no `interfacectl explain` today; human-readable text is in command output and in the `message` field of JSON findings. Explainability is a possible Phase 5 scope.
- Fail mode is the default for enforce; no silent failures. Advisory-only would require an explicit policy or flag, not the default.

---

## Surface Impact  

- **interfacectl**  
  Primary execution and gating surface for contracts in local development and CI.

- **surfaces.systems**  
  Source of canonical contract definitions consumed by interfacectl.

- **surfaceops.ai**  
  Downstream consumer of structured violation signals emitted by interfacectl. No dashboards or reporting added to the CLI.

---

## Non-Goals  

- Generating UI, code, or prompts.  
- Acting as a general-purpose linter.  
- Performing visual diffs or screenshot comparisons.  
- Providing dashboards, analytics, or reporting interfaces.  
- Making probabilistic or heuristic-based judgments.

---

## Acceptance Criteria  

1. **Contract validation:** Running `interfacectl validate` with a valid contract and compliant descriptors exits 0; with schema or compliance errors it exits non-zero and prints clear errors. Verifiable via existing validator tests and CLI integration tests.  
2. **Gating:** A run that detects violations (validate with violations, or enforce --mode fail with policy threshold exceeded) exits non-zero so CI or pre-commit can block. Verifiable by running against fixtures in `packages/interfacectl-cli/test/fixtures` and asserting exit codes.  
3. **Violation mapping:** Every finding in validate/diff/enforce JSON output includes a stable `code` and, where applicable, `category` (E0/E1/E2/E3). Violation types in `DriftViolationType` and the code map in `validate.ts` (e.g. `font.disallowed`) remain the single source of truth.  
4. **Runtime bundle (new):** A command (e.g. `interfacectl compile`) produces a versioned artifact (format TBD) that runtime or edge systems can consume. Verifiable by running the command and checking output exists and passes a minimal schema check.  
5. **Semantics consistency:** The same contract schema and compliance logic in `@surfaces/interfacectl-validator` are used for validate and for any future compile output; no duplicate semantics.  
6. **Output:** All current commands support `--format json` and text; any new commands (gate, compile) must support both where applicable.  
7. **Fail fast:** Contract load failure, schema validation failure, or config load failure exits immediately with E0 (e.g. exit 10 in v2); no partial success. Already true in validate and enforce; preserve in new code.

---

## Risks and Drift Checks  

1. **Generic lint drift:** interfacectl could drift toward generic lint behavior.  
   Mitigation: Every check must be backed by the contract schema or a contract-backed rule (e.g. diff entries tied to contract paths). Existing violation types in `violation-classifier.ts` and the validator are already contract-scoped.

2. **Observability creep:** Dashboards or aggregation could be added to the CLI.  
   Mitigation: Emit structured JSON only; no aggregation or visualization in interfacectl. Diff and validate already emit machine-readable findings; keep it that way.

3. **Design-only rules:** Aesthetic or non-behavioral rules could be added.  
   Mitigation: Enforce only what the contract declares (surfaces, sections, constraints, color policy). Existing checks (fonts, colors, layout, motion, pageFrame) are all contract-defined.

4. **Command surface sprawl:** New commands could duplicate or blur semantics.  
   Mitigation: Keep core surface to validate, diff, enforce, and any new gate/compile. Document in API.md which command to use for gating (validate vs enforce --mode fail) so "gate" is either an alias or a single recommended workflow.

5. **Repo-specific: two gating paths.** Validate runs contract compliance against descriptors; enforce --mode fail runs diff then policy. They can disagree (e.g. validate passes but diff has entries).  
   Mitigation: Decide and document the canonical gating workflow (e.g. "use validate for compliance; use enforce for policy-on-diff") and, if adding `gate`, make it a thin wrapper that calls one or both explicitly.

6. **Repo-specific: v1 exit codes default.** v2 exit codes (10/20/30) are opt-in via `--exit-codes v2` or `INTERFACECTL_EXIT_CODES=v2`. CI and docs may assume v1.  
   Mitigation: When adding CI steps, use v2 explicitly. Plan for v2 as default in a future major release; keep v1 behavior until then.

7. **Repo-specific: CI does not run interfacectl.** `.github/workflows/ci.yml` runs verify, build, test only.  
   Mitigation: Adding a contract check to CI is out of scope for this plan but should be a follow-up (e.g. optional job that runs `interfacectl validate` or `interfacectl enforce --mode fail` against a fixture or repo contract).

---

## Implementation Outline  

### Phase 0. Contract baseline (mostly done; align and document)  
- **Reuse:** Contract schema is in `packages/interfacectl-validator/src/schema/web.surface.contract.schema.json`. Validation is `validateContractStructure` in `packages/interfacectl-validator/src/index.ts` (AJV). Error taxonomy is `DriftViolationType` and the code map in `packages/interfacectl-cli/src/commands/validate.ts` (e.g. `font.disallowed`).  
- **New/minimal:** Document the minimal authoritative contract (required fields, optional color policy, deprecated allowedColors). Optionally add a short "contract concepts" section to API.md or docs. No schema change required unless adding breaking/non-breaking metadata later.

### Phase 1. Generation-time gating (map to existing commands; optional alias)  
- **Reuse:** Gating today is `interfacectl validate` (compliance) or `interfacectl enforce --mode fail` (diff + policy). Both support `--root`, `--contract`, `--config`, `--surface`, `--format json`, and v2 exit codes. Dry-run for fix mode exists (`enforce --mode fix --dry-run`).  
- **New:** Either (a) add `interfacectl gate` as an alias that runs validate (and optionally enforce fail) with a fixed set of options, or (b) document in README/API.md the recommended gating command (e.g. "for CI, run `interfacectl validate --exit-codes v2`"). If adding `gate`, wire it in `packages/interfacectl-cli/src/index.ts` and keep it thin (no duplicate logic).  
- **CI:** Out of scope for this plan; follow-up can add an optional CI job that runs validate or enforce against a repo contract.

### Phase 2. Traceability and output stability  
- **Reuse:** Contract-backed checks exist in `evaluateSurfaceCompliance` (validator) and in diff (contract vs observed descriptors). Structured violation signals are already emitted: validate/diff/enforce JSON output with `code`, `category`, `findings`/`entries`. Drift risks are in `DiffOutput.driftRisks`.  
- **New/minimal:** Phase 2 ensures all diff and enforce outputs are deterministically correlatable via `stableId`, `contractRef`, and `ruleRef` fields, without changing validation semantics or the contract schema. Ensure every diff entry that affects enforcement has a `rule` or contract path where possible (already in types; some entries may leave `rule` unset). No new checks unless they are deterministic and contract-backed.

### Phase 3. Runtime compilation (new work)  
- **New:** Implement a command (e.g. `interfacectl compile`) in `packages/interfacectl-cli`. Input: contract path (and optionally config). Output: a versioned bundle (e.g. JSON or a small artifact) that runtime or edge systems can load. Reuse: load contract and schema via same paths as validate; reuse `validateContractStructure` so only valid contracts compile.  
- **Scope:** Define bundle format (e.g. contract + metadata, no new semantics). One target initially; "multiple runtime targets" can be a later phase if needed.  
- **Location:** New command in `src/commands/compile.ts`, registered in `src/index.ts`. Validator may expose a small helper (e.g. "canonical contract shape for runtime") if useful; no duplicate compliance logic.

### Phase 4. Runtime consumption semantics (framing only)  

Phase 4 defines who consumes the compiled bundle and what the contract means at runtime. This phase is framing-only.

**In scope:**
- Documenting runtime consumption semantics.
- Clarifying how compiled artifacts may be interpreted by consumers.

**Out of scope:**
- New CLI commands.
- Enforcement behavior at runtime.
- Explainability or ergonomics.
- Policy evaluation, remediation, or agent orchestration.

See `phase-4-runtime-consumption-framing.md` for authoritative scope.

### Phase 5. Ergonomics and developer affordances (tentative)

Possible future scope includes explainability and developer tooling.
No scope is approved.
No implementation is planned.
Work in this phase is contingent on observing Phase 4 consumption patterns.

---

## Builder Checklist  

Before implementation begins:
- **Contract location:** Canonical schema is `packages/interfacectl-validator/src/schema/web.surface.contract.schema.json`. Contract files are project-specific (default `contracts/surfaces.web.contract.json` or `SURFACES_CONTRACT`). Ownership is repo; surfaces.systems is the intended source of canonical definitions per strategy.
- **Generation-time gating:** Current CI (`.github/workflows/ci.yml`) runs verify, build, test only. Gating fits as an optional job (e.g. `interfacectl validate` or `enforce --mode fail` against a repo contract). Confirm with maintainers where to add it (e.g. on PR, on main, or as an optional job).
- **Runtime consumers:** No runtime consumers for compiled bundles exist yet. Before implementing `compile`, confirm at least one consumer or a concrete bundle format requirement; otherwise defer or define a minimal format and document it for future consumers.

If any of these are unclear, stop and resolve before coding.
