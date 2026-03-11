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

test("validateContractStructure accepts optional pageFrame.containerMinWidthPx", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    layout: {
      maxContentWidth: 1200,
      pageFrame: {
        containerSelector: '[data-contract=\"page-container\"]',
        containerMaxWidthPx: 1200,
        containerMinWidthPx: 1024,
        paddingXpx: 24,
      },
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure accepts optional surface.flows policy", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    flows: {
      policy: "warn",
      requirements: [
        {
          flowId: "checkout",
          minSteps: 2,
          requiredSteps: ["start", "review"],
          requiredTransitions: [{ from: "start", to: "review" }],
          terminalSteps: ["review"],
        },
      ],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure accepts optional surface.layout.chromePolicy", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    layout: {
      maxContentWidth: 1200,
      chromePolicy: {
        policy: "off",
        targets: ["page-container", "top-level-section", "layout-container"],
        maxBorderRadiusPx: 8,
        allowOuterShadow: false,
        allowInsetShadow: true,
      },
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure accepts optional top-level token policies", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({}, {
    tokens: {
      typography: {
        policy: "warn",
        allowedTokens: ["var(--text-body)", "var(--font-sans)"],
        tokenMetadata: [
          {
            token: "var(--font-sans)",
            normalizedValue: "inter, sans-serif",
            attributes: ["font-family", "font-size"],
            aliases: ["var(--text-body)"],
          },
        ],
      },
      layout: {
        policy: "warn",
        allowedTokens: ["var(--space-6)", "var(--container-xl)"],
      },
      motion: {
        policy: "warn",
        allowedTokens: ["var(--motion-duration-fast)", "var(--motion-ease-standard)"],
      },
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure accepts optional marketing layout and typography profiles", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    marketingTypographyProfile: "marketing-sans",
    marketingTypographyPolicy: "warn",
    layout: {
      maxContentWidth: 1200,
      landingPattern: {
        policy: "strict",
        marketingLayoutProfile: "marketing-open-flow-split",
        marketingLayoutPolicy: "warn",
      },
    },
  }, {
    marketingProfiles: {
      layout: [
        {
          id: "marketing-open-flow-split",
          heroContainerMode: "open-flow",
          heroVisualPlacement: "inline-end",
          sectionDividerMode: "border-top",
          sectionSpacingProfile: "roomy",
        },
      ],
      typography: [
        {
          id: "marketing-sans",
          roles: [
            {
              role: "heroTitle",
              allowedTokens: ["var(--marketing-sans-hero-title-size)"],
            },
          ],
        },
      ],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure rejects invalid marketing profile references", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    marketingTypographyProfile: "missing-typography-profile",
    layout: {
      maxContentWidth: 1200,
      landingPattern: {
        policy: "strict",
        marketingLayoutProfile: "missing-layout-profile",
      },
    },
  }, {
    marketingProfiles: {
      layout: [
        {
          id: "marketing-open-flow-split",
          heroContainerMode: "open-flow",
          heroVisualPlacement: "inline-end",
          sectionDividerMode: "border-top",
          sectionSpacingProfile: "roomy",
        },
      ],
      typography: [
        {
          id: "marketing-sans",
          roles: [
            {
              role: "heroTitle",
              allowedTokens: ["var(--marketing-sans-hero-title-size)"],
            },
          ],
        },
      ],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("marketingLayoutProfile")),
    `expected marketingLayoutProfile error, got ${JSON.stringify(result.errors)}`,
  );
  assert.ok(
    result.errors.some((error) => error.includes("marketingTypographyProfile")),
    `expected marketingTypographyProfile error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects invalid surface.layout.chromePolicy target", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    layout: {
      maxContentWidth: 1200,
      chromePolicy: {
        policy: "strict",
        targets: ["page-container", "card-grid"],
        maxBorderRadiusPx: 8,
        allowOuterShadow: false,
        allowInsetShadow: true,
      },
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("targets")),
    `expected chromePolicy targets validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects malformed surface.flows requirements", () => {
  const schema = getBundledContractSchema();
  const contract = buildContract({
    flows: {
      policy: "strict",
      requirements: [
        {
          flowId: "checkout",
          minSteps: 0,
        },
      ],
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("minSteps")),
    `expected minSteps validation error, got ${JSON.stringify(result.errors)}`,
  );
});
