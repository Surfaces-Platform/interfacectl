import manifest from "./manifest.json" with { type: "json" };

export function validateEdgeChange(change) {
  if (!change || change.surfaceId !== manifest.surfaceId) {
    return {
      allowed: false,
      violations: [
        makeViolation("surface.mismatch", "strict", {
          surfaceId: change?.surfaceId,
        }),
      ],
    };
  }

  const violations = [];

  if (!change.sectionId) {
    violations.push(
      makeViolation("sections.required", "strict", {
        sectionId: change.sectionId,
      }),
    );
  }

  const policy = manifest.color.policy;
  const background = change.proposedStyles?.background;
  if (policy !== "off" && isDisallowedColor(background, manifest.color.allowedValues)) {
    violations.push(
      makeViolation("color.allowedValues", policy, {
        property: "background",
        value: background,
        expected: manifest.color.allowedValues,
      }),
    );
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateEdgeChange({
    surfaceId: "surfaces-web",
    sectionId: "hero",
    proposedStyles: { background: "rgba(15, 23, 42, 0.3)" },
  });
  console.log(JSON.stringify(result, null, 2));
}
