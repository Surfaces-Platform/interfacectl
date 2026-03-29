import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyUiAstChange,
  deriveLegacyContractFromUiAst,
  diffUiAst,
  migrateLegacyContractToUiAst,
  normalizeUiAst,
  summarizeUiAst,
} from "../dist/index.js";

function buildAst() {
  return {
    astId: "authoring-demo",
    version: "1.0.0",
    description: "Deterministic AST authoring fixture.",
    constraints: {
      motion: {
        allowedDurationsMs: [120],
        allowedTimingFunctions: ["linear"],
      },
    },
    color: {
      policy: "warn",
      allowedValues: ["#ffffff", "#000000"],
    },
    surfaces: [
      {
        id: "alpha-surface",
        displayName: "Alpha Surface",
        kind: "application",
        rootNodeId: "alpha.root",
        owner: "@alpha-owner",
        governance: {
          status: "draft",
          roles: {
            designers: ["@design-a"],
            engineers: ["@engineer-a"],
          },
        },
        runtime: {
          policy: "warn",
          mutationEnvelope: {
            mode: "layout-tuning",
            allowedSections: ["alpha.hero"],
          },
        },
        nodes: [
          {
            id: "alpha.root",
            kind: "group",
            children: ["alpha.hero", "alpha.submit"],
          },
          {
            id: "alpha.submit",
            kind: "action",
            label: "Continue",
            actionIntent: "continue",
          },
          {
            id: "alpha.hero",
            kind: "section",
            sectionId: "alpha.hero",
            label: "Hero",
          },
        ],
        platforms: [
          {
            platform: "ios",
            layout: {
              maxContentWidth: 600,
            },
          },
          {
            platform: "web",
            allowedFonts: ["Inter", "sans-serif"],
            layout: {
              maxContentWidth: 1120,
            },
          },
        ],
        states: [
          {
            id: "error",
            kind: "error",
            description: "Error state.",
          },
        ],
      },
      {
        id: "beta-surface",
        displayName: "Beta Surface",
        kind: "application",
        rootNodeId: "beta.root",
        nodes: [
          {
            id: "beta.root",
            kind: "group",
            children: ["beta.details"],
          },
          {
            id: "beta.details",
            kind: "detail",
            label: "Details",
          },
        ],
        platforms: [
          {
            platform: "android",
            layout: {
              maxContentWidth: 720,
            },
          },
        ],
      },
    ],
    migration: {
      sourceFormat: "web.surface.contract@1",
      escalations: [
        {
          surfaceId: "alpha-surface",
          code: "demo.escalation",
          message: "Example escalation.",
        },
      ],
    },
  };
}

test("normalizeUiAst sorts surfaces, platforms, and scalar arrays deterministically", () => {
  const normalized = normalizeUiAst(buildAst());
  assert.deepEqual(normalized.color.allowedValues, ["#000000", "#ffffff"]);
  assert.deepEqual(normalized.surfaces.map((surface) => surface.id), ["alpha-surface", "beta-surface"]);
  assert.deepEqual(
    normalized.surfaces[0].platforms.map((platform) => platform.platform),
    ["ios", "web"],
  );
});

test("summarizeUiAst reports platform-neutral AST structure", () => {
  const summary = summarizeUiAst(buildAst());
  assert.equal(summary.surfaceCount, 2);
  assert.equal(summary.platformCount, 3);
  assert.equal(summary.nodeCount, 5);
  assert.deepEqual(summary.surfaces[0].platforms, ["ios", "web"]);
  assert.deepEqual(summary.surfaces[0].actionIntents, ["continue"]);
  assert.deepEqual(summary.surfaces[0].stateIds, ["error"]);
  assert.equal(summary.surfaces[0].maxContentWidthByPlatform.web, 1120);
  assert.equal(summary.surfaces[0].maxContentWidthByPlatform.ios, 600);
});

test("applyUiAstChange updates governance, platforms, nodes, and states via AST paths", () => {
  let ast = buildAst();
  ast = applyUiAstChange(ast, {
    path: "surfaces[alpha-surface].platforms[web].layout.maxContentWidth",
    action: "set",
    value: 1280,
    summary: "Increase max width.",
  });
  ast = applyUiAstChange(ast, {
    path: "surfaces[alpha-surface].platforms[web].allowedFonts",
    action: "add",
    value: "var(--font-brand)",
    summary: "Add brand font.",
  });
  ast = applyUiAstChange(ast, {
    path: "surfaces[alpha-surface].nodes[alpha.submit].actionIntent",
    action: "set",
    value: "submit",
    summary: "Change action intent.",
  });
  ast = applyUiAstChange(ast, {
    path: "surfaces[alpha-surface].states[error].description",
    action: "set",
    value: "Updated error state.",
    summary: "Refresh error state text.",
  });
  ast = applyUiAstChange(ast, {
    path: "surfaces[alpha-surface].governance.roles.engineers",
    action: "add",
    value: "@engineer-b",
    summary: "Add second engineer reviewer.",
  });

  const summary = summarizeUiAst(ast);
  assert.equal(summary.surfaces[0].maxContentWidthByPlatform.web, 1280);
  assert.deepEqual(
    ast.surfaces[0].platforms.find((platform) => platform.platform === "web")?.allowedFonts,
    ["Inter", "sans-serif", "var(--font-brand)"],
  );
  assert.equal(
    ast.surfaces[0].nodes.find((node) => node.id === "alpha.submit")?.actionIntent,
    "submit",
  );
  assert.equal(
    ast.surfaces[0].states.find((state) => state.id === "error")?.description,
    "Updated error state.",
  );
  assert.deepEqual(ast.surfaces[0].governance.roles.engineers, ["@engineer-a", "@engineer-b"]);
});

test("diffUiAst emits deterministic AST-path diffs for consumer-neutral changes", () => {
  const before = buildAst();
  const after = applyUiAstChange(
    applyUiAstChange(before, {
      path: "surfaces[alpha-surface].owner",
      action: "set",
      value: "@new-owner",
      summary: "Change owner.",
    }),
    {
      path: "surfaces[alpha-surface].platforms[web].allowedFonts",
      action: "add",
      value: "var(--font-brand)",
      summary: "Add brand font.",
    },
  );
  const diff = diffUiAst(before, after);
  assert.deepEqual(
    diff.map((entry) => entry.path),
    [
      "surfaces[alpha-surface].owner",
      "surfaces[alpha-surface].platforms[web].allowedFonts[var(--font-brand)]",
    ],
  );
});

test("migrateLegacyContractToUiAst and deriveLegacyContractFromUiAst preserve bundle compatibility shape", () => {
  const contract = {
    contractId: "legacy-demo",
    version: "1.0.0",
    description: "Legacy contract fixture.",
    sections: [
      {
        id: "hero.main",
        intent: "hero",
        description: "Hero section.",
      },
    ],
    surfaces: [
      {
        id: "legacy-web",
        displayName: "Legacy Web",
        type: "web",
        requiredSections: ["hero.main"],
        allowedFonts: ["Inter", "sans-serif"],
        layout: {
          maxContentWidth: 960,
        },
      },
    ],
    constraints: {
      motion: {
        allowedDurationsMs: [120],
        allowedTimingFunctions: ["linear"],
      },
    },
    color: {
      policy: "warn",
      allowedValues: ["#ffffff"],
    },
  };
  const ast = migrateLegacyContractToUiAst(contract);
  const roundTripped = deriveLegacyContractFromUiAst(ast);
  assert.equal(ast.surfaces[0].platforms[0].platform, "web");
  assert.equal(roundTripped.surfaces[0].requiredSections[0], "hero.main");
  assert.equal(roundTripped.surfaces[0].layout.maxContentWidth, 960);
  assert.equal(roundTripped.color.allowedValues[0], "#ffffff");
});
