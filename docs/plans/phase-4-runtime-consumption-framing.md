# Phase 4: Runtime consumption framing

**Status:** Framing doc. No implementation. Defines what Phase 4 is allowed to be before any code exists, so the compile bundle does not quietly turn into runtime enforcement.

If runtime consumption is implemented, it may live in a separate repository or consumer-specific project rather than in interfacectl itself. This document defines semantics only, not ownership of runtime code.

---

## A. Who consumes the compiled bundle?

Choose explicitly. Options:

1. **Edge runtime**  
   Bundle is loaded on-device or at the CDN edge to constrain or inform agent-generated UI (e.g. allowed structure, boundaries). Primary or secondary consumer.

2. **Server-side renderer**  
   Bundle is used during SSR or API-driven UI assembly to know contract boundaries and constraints. Primary or secondary consumer.

3. **Design-time tools**  
   Bundle is consumed by editors, previews, or inspectors (e.g. to show allowed fonts, sections, motion). Primary or secondary consumer.

4. **Multiple consumers**  
   If more than one applies, state which is **primary** and which are **secondary**. Do not say “all of the above” without priority.

**Recommendation (to be decided):** Leave primary consumer unspecified until you see how `interfacectl compile` is used. The bundle format (manifest, normalized contract, surfaces, constraints) supports any of the above; Phase 4 is about documenting consumption semantics, not building a specific consumer.

---

## B. What is the contract at runtime?

In this document, runtime refers to any execution context where UI is rendered or adapted (browser, edge, or server), not the interfacectl CLI itself.

Clarify what the bundle represents at runtime, without enforcing yet.

- **Allowed structure boundaries**  
  Surfaces, sections, and constraints in the bundle describe what is *allowed* or *declared*, not what is *enforced* by the loader. Runtime may use this as a read-only reference.

- **Immutable vs adaptable regions**  
  The bundle does not currently distinguish “immutable” vs “adaptable” regions. If runtime needs that distinction, it would be a contract or bundle extension (out of scope for this framing).

- **What “violation” means at runtime**  
  In this repo, “violation” is a generation-time concept (validate/diff/enforce). At runtime, the bundle is a **reference**. A consumer may *compare* observed state to the bundle and *report* drift, but Phase 4 does not define or implement “runtime violation” as an enforcement action. Semantics only: the bundle describes the contract; whether and how a runtime uses it for gating, logging, or adaptation is a consumer decision.

No enforcement logic. Just semantics.

---

## C. What Phase 4 is explicitly NOT

This section matters. Phase 4 must not become “Phase 2 but later.”

- **No policy evaluation**  
  No severity thresholds, policy files, or fail/fix/pr semantics at runtime.

- **No fix or remediation**  
  No autofix, no remediation output, no file writes. The bundle is read-only input to consumers.

- **No agent orchestration**  
  No orchestration of agents, no “gate” that blocks or allows agent actions. Consumers may implement their own gating; interfacectl does not.

- **No gate semantics**  
  No new `gate` command and no runtime equivalent. Validate remains the canonical generation-time gate; compile produces an artifact. Phase 4 does not add gating behavior.

- **No new CLI commands**  
  Phase 4 is consumption semantics and possibly documentation or contracts for consumers. No new interfacectl subcommands.

---

## D. Relationship to existing phases

| Phase | Focus | Phase 4 relationship |
|-------|--------|----------------------|
| Phase 2 | Traceability (stableId, contractRef, ruleRef in diff/enforce output) | Phase 4 does not change traceability. Bundle is a separate artifact; traceability stays in CLI output. |
| Phase 3 | Artifact generation (`interfacectl compile` → manifest, normalized contract, surfaces, constraints) | Phase 4 defines *who* consumes that artifact and *what* it means at runtime. No change to bundle structure or compile behavior. |
| Phase 4 | Consumption semantics (who, what it means, what it is not) | Framing only. Makes Phase 5 (e.g. explain, or a specific consumer) possible but not inevitable. |

---

## Acceptance criteria for this framing doc

- [ ] A reader can explain Phase 4 in one sentence: *Phase 4 defines who consumes the compile bundle and what the contract means at runtime, without adding enforcement or new CLI commands.*
- [ ] It does not imply new CLI commands.
- [ ] It does not imply enforcement behavior.
- [ ] It makes Phase 5 (e.g. explain, edge loader, or SSR adapter) feel possible but not inevitable.

---

## Recommended next step

Pause. Let this framing sit. Revisit after you see how compile is used (edge-only loaders, server-side rendering adapters, or policy-aware runtime gating). Then decide primary consumer and whether any implementation belongs in this repo or in consumer projects.
