## Strategy check

- [ ] I read "docs/strategy.md"
- [ ] This PR strengthens the decision filter sentence
- [ ] Enforcement timing is explicit: generation time, runtime, or both
- [ ] Violation handling is defined: blocked, corrected, constrained, or signaled
- [ ] CLI behavior is tied to contract semantics, not free-form heuristics

## What changed
Describe the change.

## Why it matters
Explain the user-facing and system-facing impact.

## Contract and enforcement notes
1. Contract fields added or changed
2. Enforcement point impacted
3. Expected behavior on violation

## Tests
List tests added or updated.
## Phase 0 and Phase 1 PR Review Checklist

This PR claims to implement work from:
- docs/plans/contract-first-enforcement-alignment.md
- docs/plans/phase-0-1-execution-plan.md

Complete this checklist before requesting review.

---

## 1. Scope gate

- [ ] Changes are limited to Phase 0 or Phase 1 scope.
- [ ] No implementation of `compile`, `explain`, new validation rules, or schema changes.
- [ ] No CI job was added to enforce interfacectl unless explicitly approved.

If any box is unchecked, this PR is out of scope and should not merge.

---

## 2. Strategy and plan alignment

- [ ] I read docs/strategy.md.
- [ ] I read docs/plans/contract-first-enforcement-alignment.md.
- [ ] This PR preserves the decision that `validate` is the canonical generation-time gate.
- [ ] The README planning constraint remains intact.

---

## 3. Gating clarity

- [ ] Documentation clearly states that `interfacectl validate` is the canonical contract compliance gate.
- [ ] Documentation does not imply that `enforce --mode fail` is the canonical compliance gate.
- [ ] If `enforce --mode fail` is referenced, it is positioned as optional policy-based enforcement on structural diff.

---

## 4. Exit code determinism

- [ ] All new or updated CI examples explicitly use `--exit-codes v2`.
- [ ] Environment variable names referenced in docs are confirmed in code.
- [ ] Docs do not mix v1 and v2 exit code examples.

---

## 5. Contract documentation quality

- [ ] Docs describe the minimal authoritative contract and required fields.
- [ ] Deprecated contract elements are called out explicitly.
- [ ] Docs point to real schema and validation entry points.

---

## 6. Gate alias checks (only if applicable)

Apply this section only if this PR adds or modifies a `gate` command.

- [ ] `gate` delegates to `validate` only.
- [ ] `gate` introduces no new behavior or implicit workflows.
- [ ] `gate` does not invoke diff or policy logic implicitly.
- [ ] `gate` is registered in the CLI command registration entry point.
- [ ] Help text and docs state clearly that `gate` is an alias for `validate`.

---

## 7. Verification

- [ ] Documented commands run successfully against existing fixtures.
- [ ] All referenced file paths exist in the repo.
- [ ] Any referenced environment variables can be verified quickly in code.

---

## What changed

Describe the change.

## Why it matters

Explain the user-facing and system-facing impact.

## Tests

List tests added or updated.