import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContractStructure,
  getBundledContractSchema,
} from "../dist/index.js";

function buildContract(surfaceOverrides = {}, extra = {}) {
  return {
    contractId: "icon-structure-test",
    version: "1.0.0",
    surfaces: [
      {
        id: "web-surface",
        displayName: "Web Surface",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["Inter"],
        layout: {
          maxContentWidth: 1200,
        },
        ...surfaceOverrides,
      },
    ],
    sections: [
      {
        id: "main.hero",
        intent: "Hero",
        description: "Main hero section",
      },
    ],
    constraints: {
      motion: {
        allowedDurationsMs: [120],
        allowedTimingFunctions: ["linear"],
      },
    },
    color: {
      policy: "off",
      allowedValues: [],
    },
    ...extra,
  };
}

test("validateContractStructure remains backward compatible when icons are omitted", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract();
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure rejects invalid surface.icons.policy", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    icons: {
      policy: "invalid",
      allowedSources: ["lucide-react"],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("policy")),
    `expected policy validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects malformed surface.icons.allowedSources", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    icons: {
      policy: "warn",
      allowedSources: ["lucide-react", 42],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("allowedSources")),
    `expected allowedSources validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure accepts x_extracted.iconSources", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({}, {
    x_extracted: {
      iconSources: ["lucide-react", "@heroicons/react/24/outline"],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});
