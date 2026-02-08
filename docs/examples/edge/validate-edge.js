import manifest from "./manifest.json" with { type: "json" };

export function validateEdgeChange(change) {
  // change: { surfaceId, proposedStyles, sectionId }
  if (!change || change.surfaceId !== manifest.surfaceId) {
    return { allowed: false, violations: [makeViolation("surface.mismatch", "strict", { surfaceId: change?.surfaceId })] };
  }

  const violations = [];

  // Layout: require section id present
  if (!change.sectionId) {
    violations.push(makeViolation("sections.required", "strict", { sectionId: change.sectionId }));
  }

  // Color raw values
  const policy = manifest.color.rawValues.policy;
  if (policy !== "off" && hasRawColor(change.proposedStyles?.background)) {
    violations.push(makeViolation("color.rawValues", policy, {
      property: "background",
      value: change.proposedStyles?.background
    }));
  }

  const blocking = violations.find(v => v.policy === "strict");
  return {
    allowed: !blocking,
    violations,
    contract: { id: manifest.contractId, version: manifest.version, surfaceId: manifest.surfaceId }
  };
}

const RAW_COLOR_REGEX = /(rgb|hsl)a?\(/i;
function hasRawColor(value = "") { return RAW_COLOR_REGEX.test(value); }
function makeViolation(rule, policy, evidence) {
  return { rule, policy, severity: policy === "strict" ? "error" : "warn", evidence };
}

// Quick smoke test (run with `node validate-edge.js`)
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateEdgeChange({
    surfaceId: "surfaces-web",
    sectionId: "hero",
    proposedStyles: { background: "rgba(15, 23, 42, 0.3)" }
  });
  console.log(JSON.stringify(result, null, 2));
}
