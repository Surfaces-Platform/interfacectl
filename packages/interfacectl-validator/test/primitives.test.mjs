import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSurfaceCompliance } from "../dist/index.js";

test("flags shell-owned primitive emitted using shell.owns default", () => {
  const contract = {
    contractId: "demo",
    version: "1.0.0",
    sections: [],
    constraints: { motion: { allowedDurationsMs: [200], allowedTimingFunctions: ["ease"] } },
    surfaces: [
      {
        id: "runs",
        displayName: "Runs",
        type: "web",
        requiredSections: [],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1200 },
      },
    ],
    shell: {
      owns: ["navigation", "header"],
      contentSlot: "content",
    },
  };

  const descriptor = {
    surfaceId: "runs",
    sections: [],
    fonts: [{ value: "Inter" }],
    colors: [],
    layout: { maxContentWidth: 1200, containers: [], containerSources: [] },
    motion: [],
    primitives: [
      { role: "navigation", count: 2, sources: ["app/runs/page.tsx"] },
      { role: "header", count: 1 },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((v) => v.type === "shell-owned-primitive-emitted");
  assert.ok(violation, "expected violation for shell-owned primitive");
  assert.equal(violation.details.role, "navigation");
  assert.equal(violation.details.count, 2);
});

test("respects surface.mustNotEmit override when shell.owns missing", () => {
  const contract = {
    contractId: "demo",
    version: "1.0.0",
    sections: [],
    constraints: { motion: { allowedDurationsMs: [200], allowedTimingFunctions: ["ease"] } },
    surfaces: [
      {
        id: "runs",
        displayName: "Runs",
        type: "web",
        requiredSections: [],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1200 },
        mustNotEmit: ["nav"],
      },
    ],
  };

  const descriptor = {
    surfaceId: "runs",
    sections: [],
    fonts: [{ value: "Inter" }],
    colors: [],
    layout: { maxContentWidth: 1200, containers: [], containerSources: [] },
    motion: [],
    primitives: [{ role: "nav", count: 1, sources: ["app/runs/page.tsx"] }],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((v) => v.type === "shell-owned-primitive-emitted");
  assert.ok(violation, "expected violation for surface.mustNotEmit");
  assert.equal(violation.details.role, "navigation");
});

test("allows shell-owned primitive in explicit shell source path", () => {
  const contract = {
    contractId: "demo",
    version: "1.0.0",
    sections: [],
    constraints: { motion: { allowedDurationsMs: [200], allowedTimingFunctions: ["ease"] } },
    surfaces: [
      {
        id: "runs",
        displayName: "Runs",
        type: "web",
        requiredSections: [],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1200 },
        mustNotEmit: ["navigation"],
        shellOwnedPrimitiveAllowSources: ["apps/runs/app/layout.tsx"],
      },
    ],
  };

  const descriptor = {
    surfaceId: "runs",
    sections: [],
    fonts: [{ value: "Inter" }],
    colors: [],
    layout: { maxContentWidth: 1200, containers: [], containerSources: [] },
    motion: [],
    primitives: [{ role: "navigation", count: 1, sources: ["apps/runs/app/layout.tsx"] }],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((v) => v.type === "shell-owned-primitive-emitted");
  assert.equal(violation, undefined);
});

test("flags shell-owned primitive from non-shell source even when allowlist exists", () => {
  const contract = {
    contractId: "demo",
    version: "1.0.0",
    sections: [],
    constraints: { motion: { allowedDurationsMs: [200], allowedTimingFunctions: ["ease"] } },
    surfaces: [
      {
        id: "runs",
        displayName: "Runs",
        type: "web",
        requiredSections: [],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1200 },
        mustNotEmit: ["navigation"],
        shellOwnedPrimitiveAllowSources: ["apps/runs/app/layout.tsx"],
      },
    ],
  };

  const descriptor = {
    surfaceId: "runs",
    sections: [],
    fonts: [{ value: "Inter" }],
    colors: [],
    layout: { maxContentWidth: 1200, containers: [], containerSources: [] },
    motion: [],
    primitives: [
      {
        role: "navigation",
        count: 2,
        sources: ["apps/runs/app/layout.tsx", "apps/runs/app/contracts/page.tsx"],
      },
    ],
  };

  const report = evaluateSurfaceCompliance(contract, descriptor);
  const violation = report.violations.find((v) => v.type === "shell-owned-primitive-emitted");
  assert.ok(violation, "expected violation for non-shell source");
  assert.deepEqual(violation.details.disallowedSources, ["apps/runs/app/contracts/page.tsx"]);
});
