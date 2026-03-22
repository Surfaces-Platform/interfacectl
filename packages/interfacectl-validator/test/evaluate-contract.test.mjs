import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSurfaceCompliance,
  evaluateContractCompliance,
} from "../dist/index.js";

const baseContract = {
  contractId: "test.contract",
  version: "1.0.0",
  sections: [
    {
      id: "main.hero",
      intent: "hero",
      description: "Hero section",
    },
  ],
  constraints: {
    motion: {
      allowedDurationsMs: [120],
      allowedTimingFunctions: ["linear"],
    },
  },
  color: {
    policy: "strict",
    allowedValues: ["var(--color-primary)"],
  },
};

test("defaults to contract-container when requiredContainers omitted", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-a",
        displayName: "Surface A",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-a)"],
        layout: {
          maxContentWidth: 960,
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-a",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-a)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 920,
      containers: ["contract-container"],
      containerSources: ["apps/surface-a/app/page.tsx"],
    },
    motion: [
      {
        durationMs: 120,
        timingFunction: "linear",
        source: "apps/surface-a/app/globals.css",
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  assert.equal(report.violations.length, 0);
});

test("reports missing custom required containers", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-b",
        displayName: "Surface B",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-b)"],
        layout: {
          maxContentWidth: 960,
          requiredContainers: ["primary-shell", "contract-container"],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-b",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-b)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 960,
      containers: ["primary-shell"],
      containerSources: ["apps/surface-b/app/page.tsx"],
    },
    motion: [],
  };

  const summary = evaluateContractCompliance(contract, [descriptor]);
  const violations = summary.surfaceReports[0]?.violations ?? [];
  assert.equal(violations.length, 1, "expected one violation");
  const [violation] = violations;
  assert.equal(violation.type, "layout-container-missing");
  assert.deepEqual(violation.details?.requiredContainers, [
    "primary-shell",
    "contract-container",
  ]);
  assert.deepEqual(violation.details?.missingContainers, [
    "contract-container",
  ]);
});

test("captures layout width, motion, and strict color violations", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-c",
        displayName: "Surface C",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-c)"],
        layout: {
          maxContentWidth: 720,
          requiredContainers: [],
        },
      },
    ],
    color: {
      policy: "strict",
      allowedValues: ["var(--color-c)"],
    },
  };

  const descriptor = {
    surfaceId: "surface-c",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-c)" }],
    colors: [{ value: "var(--color-disallowed)" }],
    layout: {
      maxContentWidth: 960,
      containers: [],
    },
    motion: [
      {
        durationMs: 300,
        timingFunction: "ease",
        source: "apps/surface-c/app/globals.css",
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violationTypes = report.violations.map((violation) => violation.type);
  assert.deepEqual(
    violationTypes.sort(),
    [
      "color-not-allowed",
      "layout-width-exceeded",
      "motion-duration-not-allowed",
      "motion-timing-not-allowed",
    ].sort(),
  );

  const colorViolation = report.violations.find((v) => v.type === "color-not-allowed");
  assert.ok(colorViolation, "should have color violation");
  assert.equal(colorViolation.details?.color, "var(--color-disallowed)");
  assert.equal(colorViolation.details?.policy, "strict");
  assert.deepEqual(colorViolation.details?.allowedValues, ["var(--color-c)"]);
});

test("policy off skips color enforcement", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-d",
        displayName: "Surface D",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-d)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
      },
    ],
    color: {
      policy: "off",
      allowedValues: [],
    },
  };

  const descriptor = {
    surfaceId: "surface-d",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-d)" }],
    colors: [{ value: "#ff00aa" }, { value: "var(--not-allowlisted)" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const colorViolations = report.violations.filter((v) => v.type === "color-not-allowed");
  assert.equal(colorViolations.length, 0);
});

test("policy warn emits color-not-allowed with warn metadata", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-e",
        displayName: "Surface E",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-e)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
      },
    ],
    color: {
      policy: "warn",
      allowedValues: ["#ffffff"],
    },
  };

  const descriptor = {
    surfaceId: "surface-e",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-e)" }],
    colors: [{ value: "#ff00aa" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const colorViolation = report.violations.find((v) => v.type === "color-not-allowed");
  assert.ok(colorViolation);
  assert.equal(colorViolation.details?.policy, "warn");
});

test("icon policy strict reports disallowed icon sources", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-icons-strict",
        displayName: "Surface Icons Strict",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-icons)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
        icons: {
          policy: "strict",
          allowedSources: ["lucide-react"],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-icons-strict",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-icons)" }],
    colors: [{ value: "var(--color-primary)" }],
    icons: [{ value: "lucide-react" }, { value: "@heroicons/react/24/outline" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const iconViolation = report.violations.find(
    (violation) => violation.type === "icon-source-not-allowed",
  );
  assert.ok(iconViolation, "expected icon-source-not-allowed violation");
  assert.equal(iconViolation.details?.iconSource, "@heroicons/react/24/outline");
  assert.equal(iconViolation.details?.policy, "strict");
  assert.deepEqual(iconViolation.details?.allowedSources, ["lucide-react"]);
});

test("icon policy warn emits policy metadata for warn-level handling", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-icons-warn",
        displayName: "Surface Icons Warn",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-icons)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
        icons: {
          policy: "warn",
          allowedSources: [],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-icons-warn",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-icons)" }],
    colors: [{ value: "var(--color-primary)" }],
    icons: [{ value: "lucide-react" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const iconViolation = report.violations.find(
    (violation) => violation.type === "icon-source-not-allowed",
  );
  assert.ok(iconViolation);
  assert.equal(iconViolation.details?.policy, "warn");
});

test("marketing layout and typography drift emit warn-mode violations", () => {
  const contract = {
    ...baseContract,
    tokens: {
      typography: {
        policy: "warn",
        allowedTokens: [
          "var(--marketing-sans-hero-title-size)",
          "var(--marketing-sans-body-size)",
        ],
      },
    },
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
            {
              role: "body",
              allowedTokens: ["var(--marketing-sans-body-size)"],
            },
          ],
        },
      ],
    },
    surfaces: [
      {
        id: "surface-marketing",
        displayName: "Surface Marketing",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-marketing)"],
        marketingTypographyProfile: "marketing-sans",
        marketingTypographyPolicy: "warn",
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
          landingPattern: {
            policy: "strict",
            marketingLayoutProfile: "marketing-open-flow-split",
            marketingLayoutPolicy: "warn",
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-marketing",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-marketing)" }],
    colors: [{ value: "var(--color-primary)" }],
    tokenUsage: {
      typography: [{ value: "var(--marketing-sans-hero-title-size)" }],
      layout: [],
      motion: [],
    },
    marketingTypography: {
      profileId: "marketing-sans",
      roles: [
        {
          role: "heroTitle",
          tokens: [{ value: "var(--marketing-sans-body-size)" }],
        },
      ],
    },
    layout: {
      maxContentWidth: 1000,
      containers: [],
      landingPattern: {
        sectionOrder: ["main.hero"],
        topLevelSections: ["main.hero"],
        nestedSections: [],
        marketingLayoutProfile: "marketing-open-flow-split",
        heroContainerMode: "framed",
        heroVisualPlacement: "inline-end",
        sectionDividerMode: "border-top",
        sectionSpacingProfile: "roomy",
      },
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const marketingViolations = report.violations.filter((violation) =>
    violation.type.startsWith("landing-pattern-") ||
    violation.type.startsWith("marketing-typography-"),
  );

  assert.ok(
    marketingViolations.some(
      (violation) => violation.type === "landing-pattern-hero-container-mode",
    ),
  );
  assert.ok(
    marketingViolations.some(
      (violation) => violation.type === "marketing-typography-role-token",
    ),
  );
  assert.ok(
    marketingViolations.every((violation) => violation.details?.policy === "warn"),
  );
});

test("token policies report disallowed typography, layout, and motion tokens", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-token-policy",
        displayName: "Surface Token Policy",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-sans)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
      },
    ],
    tokens: {
      typography: {
        policy: "warn",
        allowedTokens: ["var(--text-body)", "var(--font-sans)"],
      },
      layout: {
        policy: "strict",
        allowedTokens: ["var(--space-6)"],
      },
      motion: {
        policy: "warn",
        allowedTokens: ["var(--motion-duration-fast)"],
      },
    },
  };

  const descriptor = {
    surfaceId: "surface-token-policy",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-sans)" }],
    colors: [{ value: "var(--color-primary)" }],
    tokenUsage: {
      typography: [{ value: "var(--text-display)", source: "app/globals.css" }],
      layout: [{ value: "var(--space-12)", source: "app/globals.css" }],
      motion: [{ value: "var(--motion-duration-slow)", source: "app/globals.css" }],
    },
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const tokenViolations = report.violations.filter((item) => item.type === "token-not-allowed");
  assert.equal(tokenViolations.length, 3);
  assert.deepEqual(
    tokenViolations.map((item) => item.details?.tokenCategory).sort(),
    ["layout", "motion", "typography"],
  );
  assert.equal(
    tokenViolations.find((item) => item.details?.tokenCategory === "layout")?.details?.policy,
    "strict",
  );
});

test("token policy accepts observed aliases that normalize to an allowlisted canonical token", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-token-alias",
        displayName: "Surface Token Alias",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-sans)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
      },
    ],
    tokens: {
      layout: {
        policy: "strict",
        allowedTokens: ["var(--space-4)"],
        tokenMetadata: [
          {
            token: "var(--space-4)",
            normalizedValue: "16px",
            attributes: ["padding-inline"],
            aliases: ["var(--space-md)"],
          },
        ],
      },
    },
  };

  const descriptor = {
    surfaceId: "surface-token-alias",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-sans)" }],
    colors: [{ value: "var(--color-primary)" }],
    tokenUsage: {
      typography: [],
      layout: [
        {
          value: "var(--space-4)",
          observedValue: "var(--space-md)",
          normalizedValue: "16px",
          attributes: ["padding-inline"],
          source: "app/globals.css",
        },
      ],
      motion: [],
    },
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const tokenViolations = report.violations.filter((item) => item.type === "token-not-allowed");
  assert.equal(tokenViolations.length, 0);
});

test("token policy violation exposes normalized details for unmatched token groups", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-token-details",
        displayName: "Surface Token Details",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-sans)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
      },
    ],
    tokens: {
      motion: {
        policy: "warn",
        allowedTokens: ["var(--motion-duration-fast)"],
        tokenMetadata: [
          {
            token: "var(--motion-duration-fast)",
            normalizedValue: "200ms",
            attributes: ["transition-duration"],
            aliases: [],
          },
        ],
      },
    },
  };

  const descriptor = {
    surfaceId: "surface-token-details",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-sans)" }],
    colors: [{ value: "var(--color-primary)" }],
    tokenUsage: {
      typography: [],
      layout: [],
      motion: [
        {
          value: "var(--motion-duration-slow)",
          observedValue: "var(--motion-duration-slow)",
          normalizedValue: "300ms",
          attributes: ["transition-duration"],
          source: "app/globals.css",
        },
      ],
    },
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((item) => item.type === "token-not-allowed");
  assert.ok(violation);
  assert.equal(violation.details?.token, "var(--motion-duration-slow)");
  assert.equal(violation.details?.canonicalToken, "var(--motion-duration-slow)");
  assert.equal(violation.details?.normalizedValue, "300ms");
});

test("mixed allowed values pass exact matching through one path", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-f",
        displayName: "Surface F",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-f)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
      },
    ],
    color: {
      policy: "strict",
      allowedValues: [
        "var(--color-token)",
        "#ffffff",
        "rgba(15,23,42,0.3)",
        "hsl(220,50%,40%)",
        "transparent",
      ],
    },
  };

  const descriptor = {
    surfaceId: "surface-f",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-f)" }],
    colors: [
      { value: "var(--color-token)" },
      { value: "#ffffff" },
      { value: "rgba(15,23,42,0.3)" },
      { value: "hsl(220,50%,40%)" },
      { value: "transparent" },
    ],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const colorViolations = report.violations.filter((v) => v.type === "color-not-allowed");
  assert.equal(colorViolations.length, 0);
});

test("reports pageFrame min-width mismatch when containerMinWidthPx is set", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-pageframe-minwidth",
        displayName: "Surface PageFrame Min Width",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-minwidth)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
          pageFrame: {
            containerSelector: '[data-contract=\"page-container\"]',
            containerMaxWidthPx: 1200,
            containerMinWidthPx: 1024,
            paddingXpx: 24,
            enforcement: "strict",
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-pageframe-minwidth",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-minwidth)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
      pageFrame: {
        containerSelector: '[data-contract=\"page-container\"]',
        maxWidthPx: 1200,
        minWidthPx: 960,
        paddingLeftPx: 24,
        paddingRightPx: 24,
        source: "apps/surface/app/layout.tsx",
      },
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "layout-pageframe-minwidth-mismatch",
  );
  assert.ok(violation);
  assert.equal(violation.details?.expected, 1024);
  assert.equal(violation.details?.actual, 960);
});

test("reports non-deterministic min-width when clamp/calc is detected", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-pageframe-minwidth-clamp",
        displayName: "Surface PageFrame Min Width Clamp",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-minwidth-clamp)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
          pageFrame: {
            containerSelector: '[data-contract=\"page-container\"]',
            containerMaxWidthPx: 1200,
            containerMinWidthPx: 1024,
            paddingXpx: 24,
            enforcement: "strict",
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-pageframe-minwidth-clamp",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-minwidth-clamp)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
      pageFrame: {
        containerSelector: '[data-contract=\"page-container\"]',
        maxWidthPx: 1200,
        minWidthPx: null,
        minWidthHasClampCalc: true,
        paddingLeftPx: 24,
        paddingRightPx: 24,
        source: "apps/surface/app/globals.css",
      },
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "layout-pageframe-non-deterministic-value",
  );
  assert.ok(violation);
  assert.equal(violation.details?.property, "min-width");
  assert.equal(violation.details?.expected, 1024);
});

test("reports selector unsupported even when pageFrame descriptor is unavailable", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-pageframe-selector",
        displayName: "Surface PageFrame Selector",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-selector)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
          pageFrame: {
            containerSelector: ".shell",
            containerMaxWidthPx: 1200,
            paddingXpx: 24,
            enforcement: "strict",
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-pageframe-selector",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-selector)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "layout-pageframe-selector-unsupported",
  );
  assert.ok(violation);
});

function makeFlowContract(policy = "strict", requirementOverrides = {}) {
  return {
    ...baseContract,
    surfaces: [
      {
        id: "surface-flow",
        displayName: "Surface Flow",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-flow)"],
        layout: {
          maxContentWidth: 1200,
          requiredContainers: [],
        },
        flows: {
          policy,
          requirements: [
            {
              flowId: "checkout",
              minSteps: 2,
              requiredSteps: ["start", "review"],
              requiredTransitions: [{ from: "start", to: "review" }],
              terminalSteps: ["review"],
              ...requirementOverrides,
            },
          ],
        },
      },
    ],
  };
}

function makeFlowDescriptor(overrides = {}) {
  return {
    surfaceId: "surface-flow",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-flow)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: [],
    },
    motion: [],
    ...overrides,
  };
}

test("flow policy emits descriptor-flows-missing when descriptor artifact is absent", () => {
  const contract = makeFlowContract("warn");
  const descriptor = makeFlowDescriptor({
    flowDescriptorPath: "contracts/generated/surface-flow.flow-descriptor.json",
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "descriptor-flows-missing",
  );
  assert.ok(violation);
  assert.equal(violation.details?.policy, "warn");
  assert.equal(
    violation.details?.flowDescriptorPath,
    "contracts/generated/surface-flow.flow-descriptor.json",
  );
});

test("flow policy emits flow-required-missing when required flow is missing", () => {
  const contract = makeFlowContract("strict");
  const descriptor = makeFlowDescriptor({
    flows: [],
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "flow-required-missing",
  );
  assert.ok(violation);
  assert.equal(violation.details?.flowId, "checkout");
  assert.equal(violation.details?.policy, "strict");
});

test("flow policy emits flow-steps-min when step count is below minimum", () => {
  const contract = makeFlowContract("strict", {
    requiredSteps: [],
    requiredTransitions: [],
    terminalSteps: [],
  });
  const descriptor = makeFlowDescriptor({
    flows: [
      {
        flowId: "checkout",
        steps: [{ id: "start" }],
        transitions: [],
      },
    ],
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "flow-steps-min",
  );
  assert.ok(violation);
  assert.equal(violation.details?.flowId, "checkout");
  assert.equal(violation.details?.actualStepCount, 1);
  assert.equal(violation.details?.minSteps, 2);
});

test("flow policy emits flow-steps-required when required step is missing", () => {
  const contract = makeFlowContract("strict", {
    minSteps: 1,
    requiredTransitions: [],
    terminalSteps: [],
  });
  const descriptor = makeFlowDescriptor({
    flows: [
      {
        flowId: "checkout",
        steps: [{ id: "start" }],
        transitions: [],
      },
    ],
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "flow-steps-required",
  );
  assert.ok(violation);
  assert.deepEqual(violation.details?.missingRequiredSteps, ["review"]);
});

test("flow policy emits flow-transition-required when required transition is missing", () => {
  const contract = makeFlowContract("strict", {
    minSteps: 1,
    requiredSteps: ["start", "review"],
    terminalSteps: [],
  });
  const descriptor = makeFlowDescriptor({
    flows: [
      {
        flowId: "checkout",
        steps: [{ id: "start" }, { id: "review" }],
        transitions: [],
      },
    ],
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "flow-transition-required",
  );
  assert.ok(violation);
  assert.deepEqual(violation.details?.missingRequiredTransitions, [
    { from: "start", to: "review" },
  ]);
});

test("flow policy does not cascade missing transition findings when a required step is absent", () => {
  const contract = makeFlowContract("warn", {
    minSteps: 2,
    requiredSteps: ["start", "review", "confirm"],
    requiredTransitions: [
      { from: "start", to: "review" },
      { from: "review", to: "confirm" },
    ],
    terminalSteps: ["confirm"],
  });
  const descriptor = makeFlowDescriptor({
    flows: [
      {
        flowId: "checkout",
        steps: [{ id: "start" }, { id: "confirm", terminal: true }],
        transitions: [{ from: "start", to: "review" }],
      },
    ],
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  assert.ok(report.violations.some((item) => item.type === "flow-steps-required"));
  assert.equal(
    report.violations.some((item) => item.type === "flow-transition-required"),
    false,
  );
});

test("flow policy emits flow-terminal-invalid when terminal step has outgoing transition", () => {
  const contract = makeFlowContract("strict", {
    minSteps: 1,
    requiredSteps: [],
    requiredTransitions: [],
    terminalSteps: ["review"],
  });
  const descriptor = makeFlowDescriptor({
    flows: [
      {
        flowId: "checkout",
        steps: [{ id: "review" }, { id: "done" }],
        transitions: [{ from: "review", to: "done" }],
      },
    ],
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "flow-terminal-invalid",
  );
  assert.ok(violation);
  assert.deepEqual(violation.details?.invalidTransitions, [
    { from: "review", to: "done" },
  ]);
});

test("flow policy emits flow-unobservable when runtime validation cannot observe contract-scoped flow markers", () => {
  const contract = makeFlowContract("warn");
  const descriptor = makeFlowDescriptor({
    flows: [],
    flowObservation: {
      source: "none-observed",
      observedFlowCount: 0,
      location: "http://127.0.0.1:3000/",
    },
  });

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "flow-unobservable",
  );
  assert.ok(violation);
  assert.equal(violation.details?.policy, "warn");
  assert.deepEqual(violation.details?.requiredMetrics, ["contractScopedFlows"]);
  assert.deepEqual(violation.details?.missingMetrics, ["contractScopedFlows"]);
});

test("reports landing pattern violations for nested sections and custom background", () => {
  const contract = {
    ...baseContract,
    sections: [
      { id: "landing.hero", intent: "hero", description: "Hero section" },
      { id: "landing.guidance", intent: "guidance", description: "Guidance section" },
      { id: "landing.actions", intent: "actions", description: "Actions section" },
    ],
    surfaces: [
      {
        id: "surface-landing-pattern",
        displayName: "Surface Landing Pattern",
        type: "web",
        requiredSections: ["landing.hero", "landing.guidance", "landing.actions"],
        allowedFonts: ["var(--font-landing)"],
        layout: {
          maxContentWidth: 1120,
          landingPattern: {
            policy: "strict",
            requireTopLevelSections: ["landing.hero", "landing.guidance", "landing.actions"],
            sectionOrder: ["landing.hero", "landing.guidance", "landing.actions"],
            pageBackgroundMode: "solid",
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-landing-pattern",
    sections: [
      { id: "landing.hero" },
      { id: "landing.guidance" },
      { id: "landing.actions" },
    ],
    fonts: [{ value: "var(--font-landing)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: ["contract-container"],
      landingPattern: {
        sectionOrder: ["landing.hero", "landing.guidance", "landing.actions"],
        topLevelSections: ["landing.hero"],
        nestedSections: ["landing.guidance", "landing.actions"],
        pageBackgroundMode: "custom",
        source: "apps/surface/app/page.tsx",
      },
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violationTypes = report.violations.map((violation) => violation.type);
  assert.ok(violationTypes.includes("landing-pattern-top-level-missing"));
  assert.ok(violationTypes.includes("landing-pattern-section-nested"));
  assert.ok(violationTypes.includes("landing-pattern-background-mode"));
});

test("passes landing pattern validation when the shared structure is preserved", () => {
  const contract = {
    ...baseContract,
    sections: [
      { id: "landing.hero", intent: "hero", description: "Hero section" },
      { id: "landing.guidance", intent: "guidance", description: "Guidance section" },
      { id: "landing.actions", intent: "actions", description: "Actions section" },
    ],
    surfaces: [
      {
        id: "surface-landing-pass",
        displayName: "Surface Landing Pass",
        type: "web",
        requiredSections: ["landing.hero", "landing.guidance", "landing.actions"],
        allowedFonts: ["var(--font-landing)"],
        layout: {
          maxContentWidth: 1120,
          landingPattern: {
            policy: "strict",
            requireTopLevelSections: ["landing.hero", "landing.guidance", "landing.actions"],
            sectionOrder: ["landing.hero", "landing.guidance", "landing.actions"],
            pageBackgroundMode: "solid",
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-landing-pass",
    sections: [
      { id: "landing.hero" },
      { id: "landing.guidance" },
      { id: "landing.actions" },
    ],
    fonts: [{ value: "var(--font-landing)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: ["contract-container"],
      landingPattern: {
        sectionOrder: ["landing.hero", "landing.guidance", "landing.actions"],
        topLevelSections: ["landing.hero", "landing.guidance", "landing.actions"],
        nestedSections: [],
        pageBackgroundMode: "solid",
        source: "apps/surface/app/page.tsx",
      },
    },
    motion: [],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const landingViolations = report.violations.filter((violation) =>
    violation.type.startsWith("landing-pattern-"),
  );
  assert.equal(landingViolations.length, 0);
});

test("reports target acquisition violations for undersized, crowded, and edge-pinned controls", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-target-acquisition",
        displayName: "Surface Target Acquisition",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-targets)"],
        layout: {
          maxContentWidth: 1120,
          targetAcquisition: {
            policy: "strict",
            modality: "touch-mouse",
            minHitAreaPx: 44,
            minGapPx: 8,
            minEdgeInsetPx: 8,
            destructiveGapPx: 16,
          },
        },
      },
    ],
    components: [
      {
        id: "toolbar",
        intent: "toolbar",
        slots: [{ id: "actions", kind: "action", required: true }],
        interactions: [
          {
            id: "compact-open",
            trigger: "click compact open",
            effect: "open",
            targetAcquisition: {
              exceptionId: "toolbar.compact-open",
              rationale: "Toolbar icon is intentionally compact.",
              minHitAreaPx: 32,
            },
          },
        ],
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-target-acquisition",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-targets)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: ["contract-container"],
    },
    motion: [],
    interactiveTargets: [
      {
        id: "compact-open",
        role: "button",
        componentId: "toolbar",
        interactionId: "compact-open",
        source: "apps/surface/app/page.tsx",
        boundingBox: { x: 0, y: 0, width: 32, height: 32 },
        hitAreaPx: 1024,
        nearestNeighborGapPx: 6,
        edgeInsetPx: 4,
        classification: "primary",
      },
      {
        id: "delete-workspace",
        role: "button",
        source: "apps/surface/app/page.tsx",
        boundingBox: { x: 0, y: 0, width: 44, height: 44 },
        hitAreaPx: 1936,
        nearestNeighborGapPx: 10,
        nearestNeighborClassification: "primary",
        edgeInsetPx: 12,
        classification: "destructive",
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violationTypes = report.violations.map((violation) => violation.type);

  assert.ok(!violationTypes.includes("target-hit-area-too-small"), "compact override should suppress hit-area failure");
  assert.ok(violationTypes.includes("target-gap-too-tight"));
  assert.ok(violationTypes.includes("target-edge-inset-too-small"));
  assert.ok(violationTypes.includes("destructive-target-too-close"));
});

test("singleton measurable target does not emit target-unobservable when no neighbor exists", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-target-acquisition-singleton",
        displayName: "Surface Target Acquisition Singleton",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-targets)"],
        layout: {
          maxContentWidth: 1120,
          targetAcquisition: {
            policy: "strict",
            modality: "touch-mouse",
            minHitAreaPx: 44,
            minGapPx: 8,
            minEdgeInsetPx: 8,
            destructiveGapPx: 16,
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-target-acquisition-singleton",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-targets)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: ["contract-container"],
    },
    motion: [],
    interactiveTargets: [
      {
        id: "solo-review",
        role: "button",
        source: "apps/surface/app/page.tsx",
        boundingBox: { x: 24, y: 24, width: 48, height: 48 },
        hitAreaPx: 2304,
        nearestNeighborGapPx: null,
        edgeInsetPx: 24,
        classification: "default",
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violationTypes = report.violations.map((violation) => violation.type);

  assert.equal(violationTypes.includes("target-unobservable"), false);
  assert.equal(violationTypes.includes("target-gap-too-tight"), false);
  assert.equal(violationTypes.includes("destructive-target-too-close"), false);
});

test("surface-level target acquisition reports unobservable when remote validation falls back to all visible controls", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-target-acquisition-fallback",
        displayName: "Surface Target Acquisition Fallback",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-targets)"],
        layout: {
          maxContentWidth: 1120,
          targetAcquisition: {
            policy: "warn",
            minHitAreaPx: 44,
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-target-acquisition-fallback",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-targets)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: ["contract-container"],
    },
    motion: [],
    interactiveTargets: [],
    interactiveTargetObservation: {
      source: "all-visible-fallback",
      allVisibleCount: 3,
      contractScopedCount: 0,
    },
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((item) => item.type === "target-unobservable");
  assert.ok(violation);
  assert.equal(violation.details?.policy, "warn");
  assert.deepEqual(violation.details?.missingMetrics, ["contractScopedInteractiveTargets"]);
  assert.equal(violation.details?.observationSource, "all-visible-fallback");
});

test("target acquisition warn policy preserves warn metadata for reporting", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-target-acquisition-warn",
        displayName: "Surface Target Acquisition Warn",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-targets)"],
        layout: {
          maxContentWidth: 1120,
          targetAcquisition: {
            policy: "warn",
            minHitAreaPx: 44,
          },
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-target-acquisition-warn",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-targets)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 1000,
      containers: ["contract-container"],
    },
    motion: [],
    interactiveTargets: [
      {
        id: "missing-metrics",
        role: "button",
        source: "apps/surface/app/page.tsx",
        nearestNeighborGapPx: null,
        edgeInsetPx: null,
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((item) => item.type === "target-unobservable");
  assert.ok(violation);
  assert.equal(violation.details?.policy, "warn");
});

test("reports feedback.state-missing for required async states that are not authored", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-feedback-missing",
        displayName: "Surface Feedback Missing",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-feedback)"],
        layout: {
          maxContentWidth: 960,
        },
        runtime: {
          feedbackRecovery: {
            policy: "warn",
          },
          contexts: [
            { id: "loading", when: "request == pending", kind: "loading" },
            { id: "empty", when: "items.length == 0", kind: "empty" },
            { id: "error", when: "request == failed", kind: "error" },
          ],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-feedback-missing",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-feedback)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 900,
      containers: ["contract-container"],
    },
    motion: [],
    asyncStates: [
      {
        id: "success",
        kind: "success",
        source: "apps/surface/app/page.tsx",
        sectionIds: ["main.hero"],
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const stateMissingViolations = report.violations.filter(
    (violation) => violation.type === "feedback-state-missing",
  );
  assert.deepEqual(
    stateMissingViolations.map((violation) => violation.details?.kind).sort(),
    ["empty", "error", "loading"],
  );
  assert.ok(stateMissingViolations.every((violation) => violation.details?.policy === "warn"));
});

test("reports feedback.recovery-action-missing when error recovery affordances are absent", () => {
  const contract = {
    ...baseContract,
    components: [
      {
        id: "dashboard-actions",
        intent: "actions",
        slots: [{ id: "actions", kind: "action", required: true }],
        interactions: [
          {
            id: "retry-dashboard",
            trigger: "click retry dashboard",
            effect: "set-state",
          },
        ],
      },
    ],
    surfaces: [
      {
        id: "surface-feedback-recovery",
        displayName: "Surface Feedback Recovery",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-feedback)"],
        layout: {
          maxContentWidth: 960,
        },
        runtime: {
          feedbackRecovery: {
            policy: "warn",
          },
          contexts: [
            { id: "loading", when: "request == pending", kind: "loading" },
            { id: "empty", when: "items.length == 0", kind: "empty" },
            {
              id: "error",
              when: "request == failed",
              kind: "error",
              requiredRecoveryActions: ["retry"],
            },
          ],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-feedback-recovery",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-feedback)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 900,
      containers: ["contract-container"],
    },
    motion: [],
    asyncStates: [
      {
        id: "loading",
        kind: "loading",
        source: "apps/surface/app/loading.tsx",
      },
      {
        id: "empty",
        kind: "empty",
        source: "apps/surface/app/page.tsx",
      },
      {
        id: "error",
        kind: "error",
        source: "apps/surface/app/error.tsx",
        recoveryActions: [],
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "feedback-recovery-action-missing",
  );
  assert.ok(violation);
  assert.deepEqual(violation.details?.missingRecoveryActions, ["retry"]);
  assert.equal(violation.details?.policy, "warn");
});

test("reports feedback.pending-action-not-blocked when pending submit remains enabled", () => {
  const contract = {
    ...baseContract,
    components: [
      {
        id: "dashboard-actions",
        intent: "actions",
        slots: [{ id: "actions", kind: "action", required: true }],
        interactions: [
          {
            id: "submit-refresh",
            trigger: "click refresh",
            effect: "submit",
          },
        ],
      },
    ],
    surfaces: [
      {
        id: "surface-feedback-pending",
        displayName: "Surface Feedback Pending",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-feedback)"],
        layout: {
          maxContentWidth: 960,
        },
        runtime: {
          feedbackRecovery: {
            policy: "warn",
          },
          contexts: [
            {
              id: "loading",
              when: "request == pending",
              kind: "loading",
              blockedActionsWhilePending: ["submit-refresh"],
            },
            { id: "empty", when: "items.length == 0", kind: "empty" },
            { id: "error", when: "request == failed", kind: "error" },
          ],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-feedback-pending",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-feedback)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 900,
      containers: ["contract-container"],
    },
    motion: [],
    asyncStates: [
      {
        id: "loading",
        kind: "loading",
        source: "apps/surface/app/loading.tsx",
        blockedActions: [
          {
            interactionId: "submit-refresh",
            disabled: false,
          },
        ],
      },
      {
        id: "empty",
        kind: "empty",
        source: "apps/surface/app/page.tsx",
      },
      {
        id: "error",
        kind: "error",
        source: "apps/surface/app/error.tsx",
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "feedback-pending-action-not-blocked",
  );
  assert.ok(violation);
  assert.deepEqual(violation.details?.missingBlockedActions, ["submit-refresh"]);
  assert.equal(violation.details?.policy, "warn");
});

test("reports feedback.last-good-content-missing when required preserved content is absent", () => {
  const contract = {
    ...baseContract,
    sections: [
      ...baseContract.sections,
      {
        id: "main.queue",
        intent: "queue",
        description: "Queue section",
      },
    ],
    surfaces: [
      {
        id: "surface-feedback-preserve",
        displayName: "Surface Feedback Preserve",
        type: "web",
        requiredSections: ["main.hero", "main.queue"],
        allowedFonts: ["var(--font-feedback)"],
        layout: {
          maxContentWidth: 960,
        },
        runtime: {
          feedbackRecovery: {
            policy: "warn",
            requiredStateKinds: ["error"],
          },
          contexts: [
            {
              id: "error",
              when: "request == failed",
              kind: "error",
              preserveSections: ["main.hero", "main.queue"],
              preserveLastGoodContent: true,
            },
          ],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-feedback-preserve",
    sections: [{ id: "main.hero" }, { id: "main.queue" }],
    fonts: [{ value: "var(--font-feedback)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 900,
      containers: ["contract-container"],
    },
    motion: [],
    asyncStates: [
      {
        id: "error",
        kind: "error",
        source: "apps/surface/app/error.tsx",
        sectionIds: ["main.hero"],
        preserveLastGoodContent: false,
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find(
    (item) => item.type === "feedback-last-good-content-missing",
  );
  assert.ok(violation);
  assert.deepEqual(violation.details?.missingPreserveSections, ["main.queue"]);
  assert.equal(violation.details?.preserveLastGoodContentObserved, false);
  assert.equal(violation.details?.policy, "warn");
});

test("feedback recovery passes when authored states and affordances satisfy the contract", () => {
  const contract = {
    ...baseContract,
    components: [
      {
        id: "dashboard-actions",
        intent: "actions",
        slots: [{ id: "actions", kind: "action", required: true }],
        interactions: [
          {
            id: "submit-refresh",
            trigger: "click refresh",
            effect: "submit",
          },
          {
            id: "retry-dashboard",
            trigger: "click retry dashboard",
            effect: "set-state",
          },
        ],
      },
    ],
    sections: [
      ...baseContract.sections,
      {
        id: "main.queue",
        intent: "queue",
        description: "Queue section",
      },
    ],
    surfaces: [
      {
        id: "surface-feedback-pass",
        displayName: "Surface Feedback Pass",
        type: "web",
        requiredSections: ["main.hero", "main.queue"],
        allowedFonts: ["var(--font-feedback)"],
        layout: {
          maxContentWidth: 960,
        },
        runtime: {
          feedbackRecovery: {
            policy: "warn",
            requiredStateKinds: ["loading", "empty", "error", "success"],
          },
          contexts: [
            {
              id: "loading",
              when: "request == pending",
              kind: "loading",
              blockedActionsWhilePending: ["submit-refresh"],
            },
            { id: "empty", when: "items.length == 0", kind: "empty" },
            {
              id: "error",
              when: "request == failed",
              kind: "error",
              requiredRecoveryActions: ["retry"],
              preserveSections: ["main.hero", "main.queue"],
              preserveLastGoodContent: true,
            },
            { id: "success", when: "request == fulfilled", kind: "success" },
          ],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-feedback-pass",
    sections: [{ id: "main.hero" }, { id: "main.queue" }],
    fonts: [{ value: "var(--font-feedback)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 900,
      containers: ["contract-container"],
    },
    motion: [],
    asyncStates: [
      {
        id: "loading",
        kind: "loading",
        source: "apps/surface/app/loading.tsx",
        blockedActions: [
          {
            interactionId: "submit-refresh",
            disabled: true,
          },
        ],
      },
      {
        id: "empty",
        kind: "empty",
        source: "apps/surface/app/page.tsx",
      },
      {
        id: "error",
        kind: "error",
        source: "apps/surface/app/error.tsx",
        sectionIds: ["main.hero", "main.queue"],
        recoveryActions: ["retry"],
        preserveLastGoodContent: true,
      },
      {
        id: "success",
        kind: "success",
        source: "apps/surface/app/page.tsx",
        sectionIds: ["main.hero", "main.queue"],
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const feedbackViolations = report.violations.filter((violation) =>
    violation.type.startsWith("feedback-"),
  );
  assert.equal(feedbackViolations.length, 0, JSON.stringify(feedbackViolations, null, 2));
});

test("surface-level feedback recovery reports unobservable when remote validation finds no contract-scoped async states", () => {
  const contract = {
    ...baseContract,
    surfaces: [
      {
        id: "surface-feedback-unobservable",
        displayName: "Surface Feedback Unobservable",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["var(--font-feedback)"],
        layout: {
          maxContentWidth: 960,
        },
        runtime: {
          feedbackRecovery: {
            policy: "warn",
          },
          contexts: [
            { id: "loading", when: "request == pending", kind: "loading" },
            { id: "empty", when: "items.length == 0", kind: "empty" },
            { id: "error", when: "request == failed", kind: "error" },
          ],
        },
      },
    ],
  };

  const descriptor = {
    surfaceId: "surface-feedback-unobservable",
    sections: [{ id: "main.hero" }],
    fonts: [{ value: "var(--font-feedback)" }],
    colors: [{ value: "var(--color-primary)" }],
    layout: {
      maxContentWidth: 900,
      containers: ["contract-container"],
    },
    motion: [],
    asyncStates: [],
    asyncStateObservation: {
      source: "none-observed",
      observedStateCount: 0,
    },
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((item) => item.type === "feedback-unobservable");
  assert.ok(violation);
  assert.equal(violation.details?.policy, "warn");
  assert.deepEqual(violation.details?.missingMetrics, ["contractScopedAsyncStates"]);
});
