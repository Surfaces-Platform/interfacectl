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
