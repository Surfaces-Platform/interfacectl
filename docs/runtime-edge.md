# Runtime (Edge) Enforcement Guide

Goal: show how to consume the current interface contract at `Runtime (edge)` for adaptive UI gating.

Terminology follows `docs/taxonomy.md`:

- This guide covers `Runtime (edge)` only.
- `Generation time` and `CI/CD time` are separate contexts.

## Inputs and derived manifest

- Source contract: `contracts/surfaces.web.contract.json`
- Optional runtime manifest (per-surface slice):

```json
{
  "contractId": "surfaces.web",
  "version": "0.1.0",
  "surfaceId": "surfaces-web",
  "layout": { "maxContentWidth": 1160, "requiredContainers": ["contract-container"] },
  "color": {
    "policy": "warn",
    "allowedValues": ["var(--color-bg)", "#ffffff"]
  },
  "motion": {
    "allowedDurationsMs": [120, 160, 200, 240],
    "allowedTimingFunctions": ["ease", "ease-in-out", "var(--contract-motion-timing)"]
  }
}
```

Always attach provenance to decisions: `contractId`, `version`, `surfaceId`.

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
  "rule": "color.allowedValues",
  "policy": "warn",
  "evidence": { "property": "background", "value": "rgba(15,23,42,0.3)" },
  "action": "allow"
}
```

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
