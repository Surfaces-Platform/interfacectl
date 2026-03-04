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
