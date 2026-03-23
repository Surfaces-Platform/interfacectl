# Runtime (Edge) Enforcement Guide

Goal: show how to consume the current interface contract at `Runtime (edge)` for adaptive UI gating and how that runtime policy lines up with canonical browser-observed validation.

Terminology follows `docs/taxonomy.md`:

- This guide covers `Runtime (edge)` only.
- `Generation time` and `CI/CD time` are separate contexts.

## Inputs and derived runtime payload

- Source contract: `contracts/surfaces.web.contract.json`
- Compile a per-surface bundle:

```bash
interfacectl compile --contract ./contracts/surfaces.web.contract.json --out ./artifacts/runtime-bundle
```

- Resolve one adapter-ready runtime payload:

```bash
interfacectl prepare-runtime \
  --bundle-root ./artifacts/runtime-bundle \
  --surface surfaces-web \
  --out ./artifacts/runtime-inputs/surfaces-web.json
```

- The compiled bundle includes `surfaces/<surfaceId>/runtime.json`. A representative runtime slice looks like:

```json
{
  "provenance": {
    "contractId": "surfaces.web",
    "contractVersion": "0.1.0"
  },
  "identity": {
    "surfaceId": "surfaces-web",
    "displayName": "Surfaces Web",
    "type": "web"
  },
  "runtime": {
    "policy": "strict",
    "policySeverities": {
      "interaction": "warn",
      "runtime": "strict",
      "structure": "strict"
    },
    "mutationEnvelope": {
      "mode": "slot-bound"
    },
    "contexts": [
      { "id": "launch", "policy": "warn" },
      { "id": "error", "kind": "error", "requiredRecoveryActions": ["retry"] }
    ],
    "feedbackRecovery": {
      "policy": "warn",
      "requiredStateKinds": ["loading", "empty", "error", "success"]
    },
    "structure": {
      "requiredSections": ["landing.hero"],
      "flowSummary": {
        "policy": "warn",
        "flowIds": ["signup"],
        "requirementCount": 1
      }
    },
    "interaction": {
      "targetAcquisition": {
        "policy": "warn",
        "minHitAreaPx": 44,
        "minGapPx": 8,
        "minEdgeInsetPx": 8,
        "destructiveGapPx": 16
      }
    }
  }
}
```

Always attach provenance to decisions: `provenance.contractId`, `provenance.contractVersion`, and `identity.surfaceId`.

`prepare-runtime` turns that slice into one deterministic payload with provenance, governance, summary checklist items, and evidence refs. Runtime consumers can read `runtime.json` directly if they want, but `prepare-runtime` is the canonical adapter-ready handoff.

## Enforcement behavior

- `strict`: block change
- `warn`: allow and emit violation
- `off`: skip color check

## Violation payload shape

```json
{
  "surfaceId": "surfaces-web",
  "contractId": "surfaces.web",
  "version": "0.1.0",
  "rule": "target.hit-area-too-small",
  "policy": "warn",
  "evidence": {
    "targetId": "primary-cta",
    "measuredHitAreaPx": { "width": 36, "height": 36 },
    "requiredMinHitAreaPx": 44
  },
  "action": "allow"
}
```

The same shape applies to browser-observed `flow.*` and `feedback.*` findings. Consumer repos may remap these into dashboards or repair guidance, but the rule codes and their meanings stay canonical in `interfacectl`.

## Observation model

Browser-observed runtime validation uses `interfacectl validate --remote-url ...` and the same contract semantics as compiled runtime consumers.

### Target acquisition

Runtime observation measures rendered controls and can emit:

- `target.hit-area-too-small`
- `target.gap-too-tight`
- `target.edge-inset-too-small`
- `target.destructive-too-close`
- `target.unobservable`

### Flow observability

Runtime observation reads `data-contract-flow-*` markers and can emit:

- `flow.steps.required`
- `flow.transition.required`
- `flow.terminal.invalid`
- `flow.unobservable`

### Feedback and recovery

Runtime observation reads `data-contract-state-*` and `data-contract-recovery-action` markers and can emit:

- `feedback.recovery-action-missing`
- `feedback.pending-action-not-blocked`
- `feedback.last-good-content-missing`
- `feedback.unobservable`

## Edge adapter example (Node)

See: `docs/examples/edge/validate-edge.js`

```javascript
import manifest from "./manifest.json" assert { type: "json" };

export function validateEdgeChange(change) {
  const violations = [];

  if (!change.sectionId) {
    violations.push(makeViolation("sections.required", "strict", { sectionId: change.sectionId }));
  }

  const colorPolicy = manifest.color.policy;
  const background = change.proposedStyles?.background;
  if (colorPolicy !== "off" && isDisallowedColor(background, manifest.color.allowedValues)) {
    violations.push(makeViolation("color.allowedValues", colorPolicy, {
      property: "background",
      value: background,
      expected: manifest.color.allowedValues,
    }));
  }

  const blocking = violations.find((v) => v.policy === "strict");
  return {
    allowed: !blocking,
    violations,
    contract: {
      id: manifest.contractId,
      version: manifest.version,
      surfaceId: manifest.surfaceId,
    },
  };
}

function isDisallowedColor(value = "", allowedValues = []) {
  const normalized = normalizeColorValue(value);
  const allowed = new Set(allowedValues.map(normalizeColorValue));
  return normalized.length > 0 && !allowed.has(normalized);
}

function normalizeColorValue(value = "") {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([(),/:])\s*/g, "$1")
    .replace(/\s*\-\-\s*/g, "--");
}

function makeViolation(rule, policy, evidence) {
  return {
    rule,
    policy,
    severity: policy === "strict" ? "error" : "warn",
    evidence,
  };
}
```

## Native stubs

Swift:

```swift
func isDisallowedColor(_ value: String, allowedValues: [String]) -> Bool {
  let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if normalized.isEmpty { return false }
  return !allowedValues.contains(normalized)
}
```

Kotlin:

```kotlin
fun isDisallowedColor(value: String, allowedValues: List<String>): Boolean {
  val normalized = value.trim()
  if (normalized.isEmpty()) return false
  return !allowedValues.contains(normalized)
}
```

## Runtime notes

- Keep manifest small and per-surface.
- Avoid network fetches in hot paths.
- Emit violations with provenance for observability and incident correlation.
- Preserve the same rule codes and evidence semantics whether findings come from a compiled runtime consumer or from `validate --remote-url`.
- Consumer repos may wrap or visualize these findings, but canonical meaning stays in `interfacectl`.
