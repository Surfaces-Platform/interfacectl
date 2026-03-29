import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUiAstIntegrationContract,
  buildUiAstLifecycleRecord,
  buildUiAstObservedEvidence,
  buildUiAstObservationContract,
  buildUiAstProposalContract,
  buildUiAstReviewArtifact,
  buildUiAstRuntimeVerdict,
} from "../dist/index.js";

function buildAst() {
  return {
    astId: "control-plane-demo",
    version: "1.2.3",
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
            children: ["main.hero", "content.title", "primary.submit"],
          },
          {
            id: "main.hero",
            kind: "section",
            sectionId: "main.hero",
            label: "Hero",
            children: ["content.title", "primary.submit"],
          },
          {
            id: "content.title",
            kind: "heading",
            textRole: "title",
            headingLevel: 1,
            label: "Title",
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
            },
          },
          {
            platform: "ios",
            layout: {
              maxContentWidth: 640,
            },
          },
        ],
        states: [
          {
            id: "loading",
            kind: "loading",
          },
        ],
        governance: {
          status: "approved",
          roles: {
            designers: ["design@example.com"],
            engineers: ["eng@example.com"],
          },
          approvals: [
            {
              role: "designer",
              owner: "design@example.com",
              status: "approved",
              timestamp: "2026-03-28T12:00:00.000Z",
            },
            {
              role: "engineering",
              owner: "eng@example.com",
              status: "approved",
              timestamp: "2026-03-28T12:05:00.000Z",
            },
          ],
        },
        runtime: {
          policy: "strict",
          mutationEnvelope: {
            mode: "content-only",
            allowedSections: ["main.hero"],
          },
        },
        flows: {
          policy: "warn",
          requirements: [
            {
              flowId: "checkout",
              requiredTransitions: [{ from: "review", to: "confirm" }],
            },
          ],
        },
      },
    ],
  };
}

test("buildUiAstLifecycleRecord derives lifecycle stage and approval defaults", () => {
  const lifecycle = buildUiAstLifecycleRecord(buildAst(), {
    surfaceId: "demo-surface",
    validationStatus: "passed",
    publishedAt: "2026-03-28T12:10:00.000Z",
  });

  assert.equal(lifecycle.stage, "published");
  assert.equal(lifecycle.approval.status, "approved");
  assert.deepEqual(lifecycle.approval.requiredRoles, ["designer", "engineering"]);
});

test("buildUiAstReviewArtifact annotates node and governance changes", () => {
  const before = buildAst();
  const after = buildAst();
  after.surfaces[0].nodes[3].actionIntent = "submit";
  after.surfaces[0].governance.status = "published";

  const review = buildUiAstReviewArtifact(before, after, "demo-surface");
  assert.equal(review.review.requiresHumanReview, true);
  assert.ok(review.changes.some((entry) => entry.nodeId === "primary.submit"));
  assert.ok(review.changes.some((entry) => entry.reviewHint === "governance"));
});

test("proposal, integration, and runtime control-plane contracts are deterministic", () => {
  const ast = buildAst();
  const lifecycle = buildUiAstLifecycleRecord(ast, {
    surfaceId: "demo-surface",
    validationStatus: "passed",
  });
  const proposal = buildUiAstProposalContract(
    ast,
    {
      lifecycle,
      repairMap: {
        repairs: [
          {
            code: "section.missing",
            priority: "high",
            category: "structure",
            action: { type: "ensure-required-sections" },
          },
        ],
      },
    },
    "demo-surface",
  );
  const integration = buildUiAstIntegrationContract(ast, lifecycle, "demo-surface");
  const observation = buildUiAstObservationContract(ast, lifecycle, "demo-surface");

  assert.equal(proposal.repairGuidance[0].nextAction.includes("required sections"), true);
  assert.ok(
    integration.rendererBindings.some((binding) => binding.platform === "web"),
  );
  assert.ok(observation.mutationEnvelope.adaptableNodeIds.includes("content.title"));
  assert.ok(observation.mutationEnvelope.immutableNodeIds.includes("main.hero"));
});

test("runtime evidence produces stable drift classification and verdicts", () => {
  const ast = buildAst();
  const lifecycle = buildUiAstLifecycleRecord(ast, {
    surfaceId: "demo-surface",
    validationStatus: "passed",
  });
  const observation = buildUiAstObservationContract(ast, lifecycle, "demo-surface");
  const evidence = buildUiAstObservedEvidence({
    contract: observation,
    source: "edge-runtime",
    observedAt: "2026-03-28T12:30:00.000Z",
    platform: "web",
    observedNodeIds: ["demo-surface.root", "main.hero", "content.title"],
    observedActionIntents: [],
    observedStateIds: [],
  });
  const verdict = buildUiAstRuntimeVerdict(observation, evidence, "strict");

  assert.deepEqual(evidence.drift.missingActionIntents, ["continue"]);
  assert.equal(verdict.verdict, "block");
  assert.equal(verdict.code, "runtime.required-action.missing");
});
