import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBundledUiAstSchema,
  validateUiAstStructure,
} from "../dist/index.js";

function buildAst() {
  return {
    astId: "validator-demo",
    version: "1.0.0",
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
    surfaces: [
      {
        id: "demo-surface",
        displayName: "Demo Surface",
        kind: "application",
        rootNodeId: "demo-surface.root",
        nodes: [
          {
            id: "demo-surface.root",
            kind: "group",
            label: "Demo Surface",
            children: ["main.hero", "primary.submit"],
          },
          {
            id: "main.hero",
            kind: "section",
            sectionId: "main.hero",
            label: "Primary Intro",
          },
          {
            id: "primary.submit",
            kind: "action",
            label: "Continue",
            actionIntent: "continue",
          },
        ],
        platforms: [
          {
            platform: "web",
            layout: {
              maxContentWidth: 960,
              targetAcquisition: {
                policy: "warn",
                minHitAreaPx: 44,
                viewportOverrides: [
                  {
                    viewport: "mobile",
                    minHitAreaPx: 48,
                  },
                ],
                contextOverrides: [
                  {
                    context: "checkout",
                    destructiveGapPx: 24,
                  },
                ],
              },
            },
          },
        ],
        states: [
          {
            id: "checkout",
            description: "Checkout flow",
          },
        ],
      },
    ],
  };
}

test("validateUiAstStructure accepts a bounded semantic AST", () => {
  const schema = getBundledUiAstSchema();
  const result = validateUiAstStructure(buildAst(), schema);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validateUiAstStructure rejects free-form styling fields", () => {
  const schema = getBundledUiAstSchema();
  const ast = buildAst();
  ast.surfaces[0].nodes[1].style = { color: "red" };
  const result = validateUiAstStructure(ast, schema);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("style")));
});

test("validateUiAstStructure rejects embedded business logic fields", () => {
  const schema = getBundledUiAstSchema();
  const ast = buildAst();
  ast.surfaces[0].nodes[2].handler = "if (valid) submit()";
  const result = validateUiAstStructure(ast, schema);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("handler")));
});

test("validateUiAstStructure rejects nodes without stable ids", () => {
  const schema = getBundledUiAstSchema();
  const ast = buildAst();
  delete ast.surfaces[0].nodes[1].id;
  const result = validateUiAstStructure(ast, schema);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("/surfaces/0/nodes/1")));
});

test("validateUiAstStructure rejects unsupported vocabulary", () => {
  const schema = getBundledUiAstSchema();
  const ast = buildAst();
  ast.surfaces[0].nodes[1].kind = "card";
  const result = validateUiAstStructure(ast, schema);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("/surfaces/0/nodes/1/kind")));
});
