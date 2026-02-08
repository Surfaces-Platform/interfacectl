# Runtime (Edge) Enforcement Guide

Goal: show how to use the existing interface contract to gate adaptive UI changes at runtime (edge) in CDN/serverless and native shells. No schema changes - this consumes the current contract fields (layout, color, motion, sections).

Terminology follows `docs/taxonomy.md`:
- This guide covers `Runtime (edge)` only.
- `Generation time` and `CI/CD time` are separate enforcement contexts.

## Inputs and derived manifest

- Source contract: `contracts/surfaces.web.contract.json`
- Optional derived runtime manifest (suggested, not required) — subset per surface:
  ```json
  {
    "contractId": "surfaces.web",
    "version": "0.1.0",
    "surfaceId": "surfaces-web",
    "layout": { "maxContentWidth": 1160, "requiredContainers": ["contract-container"] },
    "color": {
      "sourceOfTruth": { "type": "tokens", "tokenNamespaces": ["--color-", "--background"] },
      "rawValues": { "policy": "warn", "allowlist": [], "denylist": [] }
    },
    "motion": {
      "allowedDurationsMs": [120, 160, 200, 240],
      "allowedTimingFunctions": ["ease", "ease-in-out", "var(--contract-motion-timing)"]
    }
  }
  ```
- Keep provenance with every decision: contractId, version, surfaceId.

## Enforcement behaviors (policy-driven)
- `strict`: block the change; return violation payload.
- `warn`: allow but emit violation payload with `severity: "warn"`.
- `off`: skip check.

## Violation payload shape (edge/native)
```json
{
  "surfaceId": "surfaces-web",
  "contractId": "surfaces.web",
  "version": "0.1.0",
  "rule": "color.rawValues",
  "policy": "warn",
  "evidence": { "property": "background", "value": "rgba(15,23,42,0.3)" },
  "location": { "node": "header.hero", "file": "app/globals.css" },
  "action": "allow" // or "block"
}
```

## Edge adapter (Node/edge function example)
Place near your edge handler, e.g., `docs/interfacectl/examples/edge/validate-edge.js`.

```javascript
import manifest from "./manifest.json" assert { type: "json" };

export function validateEdgeChange(change) {
  // change: { surfaceId, proposedStyles, sectionId }
  const violations = [];

  // Layout: enforce required container
  if (!change.sectionId || change.sectionId === "") {
    violations.push(makeViolation("sections.required", "strict", { sectionId: change.sectionId }));
  }

  // Color raw values
  const policy = manifest.color.rawValues.policy;
  if (policy !== "off" && hasRawColor(change.proposedStyles.background)) {
    violations.push(makeViolation("color.rawValues", policy, {
      property: "background",
      value: change.proposedStyles.background
    }));
  }

  const blocking = violations.find(v => v.policy === "strict");
  return {
    allowed: !blocking,
    violations,
    contract: { id: manifest.contractId, version: manifest.version, surfaceId: manifest.surfaceId }
  };
}

const RAW_COLOR_REGEX = /(rgb|hsl)a?\\(/i;
function hasRawColor(value = "") { return RAW_COLOR_REGEX.test(value); }
function makeViolation(rule, policy, evidence) {
  return { rule, policy, severity: policy === "strict" ? "error" : "warn", evidence };
}
```

## Native stubs (Swift / Kotlin skeletons)

Swift:
```swift
struct ContractManifest: Decodable {
  let contractId: String
  let version: String
  let surfaceId: String
  let color: ColorPolicy
}

func validateBackground(_ value: String, manifest: ContractManifest) -> Bool {
  guard manifest.color.rawValues.policy != "off" else { return true }
  let rawPattern = try! NSRegularExpression(pattern: "(rgb|hsl)a?\\(", options: .caseInsensitive)
  let range = NSRange(location: 0, length: value.utf16.count)
  return rawPattern.firstMatch(in: value, options: [], range: range) == nil
}
```

Kotlin:
```kotlin
data class Manifest(
  val contractId: String,
  val version: String,
  val surfaceId: String,
  val color: ColorPolicy
)

fun validateBackground(value: String, manifest: Manifest): Boolean {
  if (manifest.color.rawValues.policy == "off") return true
  return !Regex(\"\"\"(rgb|hsl)a?\\(\"\"\", RegexOption.IGNORE_CASE).containsMatchIn(value)
}
```

## Fallback and logging
- On `strict` violation: block and return payload; caller decides UI fallback (e.g., remove adaptation, use last-known-good style).
- On `warn`: allow, log payload (edge: console/log drain; native: telemetry buffer).
- Include contract provenance in all logs for debuggability.

## Performance notes
- Keep manifest small (per-surface slice).
- Avoid network fetch in hot paths; preload manifest.
- Regex checks only; no DOM traversal at edge/runtime.

## Test checklist
- Strict policy blocks known-bad change.
- Warn policy passes but logs payload.
- Provenance fields present.
- Empty/unknown surfaceId returns error early.
