import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import {
  getBundledContractSchema,
  validateContractStructure,
} from "../dist/index.js";

const fixturePath = path.join(
  url.fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "authoring",
  "reference-target-web.contract.json",
);

async function loadFixture() {
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw);
}

test("validateContractStructure accepts generic authoring metadata for a web surface", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure accepts governance and runtime metadata for a web surface", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].owner = "designers@example.com";
  contract.surfaces[0].governance = {
    status: "review",
    roles: {
      designers: ["designers@example.com"],
      engineers: ["eng@example.com"],
    },
    approvals: [
      {
        role: "designer",
        owner: "designers@example.com",
        status: "approved",
        timestamp: "2026-03-16T10:00:00Z",
      },
    ],
  };
  contract.surfaces[0].runtime = {
    policy: "strict",
    mutationEnvelope: {
      mode: "slot-bound",
      scopes: ["content", "components"],
      allowedActions: ["update-copy", "swap-variant"],
      allowedSections: ["page.intro"],
    },
    contexts: [
      {
        id: "launch",
        when: "route == '/'",
        requiredSections: ["page.intro"],
      },
    ],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true);
});

test("validateContractStructure rejects section anatomy references to unknown components", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.sections[0].anatomy.defaultComponent = "missing-component";
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/sections/page.intro/anatomy/defaultComponent")),
    `expected defaultComponent validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects component states that reference unknown slots", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.components[1].states[0].requiredSlots.push("missing-slot");
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/components/feature-card/states/default/requiredSlots/missing-slot")),
    `expected requiredSlots validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects interactions with unknown effects", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.components[1].interactions[0].effect = "launch";
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/components/1/interactions/0/effect")),
    `expected effect schema validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects invalid viewport ranges", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].viewports[0].minWidthPx = 900;
  contract.surfaces[0].viewports[0].maxWidthPx = 767;
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/viewports/mobile")),
    `expected viewport range validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects runtime metadata that references unknown sections", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    mutationEnvelope: {
      mode: "content-only",
      allowedSections: ["missing.section"],
    },
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/runtime/mutationEnvelope/allowedSections/missing.section")),
    `expected runtime section reference validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure accepts target acquisition metadata with viewport, context, and interaction overrides", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    policy: "warn",
    contexts: [
      {
        id: "checkout",
        when: "route == '/checkout'",
      },
    ],
  };
  contract.surfaces[0].layout.targetAcquisition = {
    policy: "warn",
    modality: "touch-mouse",
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
  };
  contract.components[1].interactions[0].targetAcquisition = {
    exceptionId: "feature-card.compact-nav",
    rationale: "Marketing rail keeps secondary actions compact.",
    minHitAreaPx: 40,
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validateContractStructure rejects target acquisition overrides that reference unknown viewport or context ids", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].layout.targetAcquisition = {
    policy: "warn",
    viewportOverrides: [{ viewport: "tablet" }],
    contextOverrides: [{ context: "checkout" }],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/layout/targetAcquisition/viewportOverrides/tablet")),
    `expected viewport override validation error, got ${JSON.stringify(result.errors)}`,
  );
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/layout/targetAcquisition/contextOverrides/checkout")),
    `expected context override validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects duplicate target acquisition exception ids within a component", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.components[1].interactions[0].targetAcquisition = {
    exceptionId: "feature-card.compact-nav",
    rationale: "First exception",
  };
  contract.components[1].interactions.push({
    id: "secondary-cta",
    trigger: "click secondary",
    effect: "navigate",
    navigationTarget: "#secondary",
    targetAcquisition: {
      exceptionId: "feature-card.compact-nav",
      rationale: "Duplicate exception id",
    },
  });
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/components/feature-card/interactions/secondary-cta/targetAcquisition/exceptionId")),
    `expected duplicate exception validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure accepts feedback recovery metadata with required async contexts", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    policy: "warn",
    feedbackRecovery: {
      policy: "warn",
      requiredStateKinds: ["loading", "empty", "error", "success"],
    },
    contexts: [
      {
        id: "loading",
        when: "request == pending",
        kind: "loading",
        blockedActionsWhilePending: ["primary-cta"],
      },
      {
        id: "empty",
        when: "items.length == 0",
        kind: "empty",
      },
      {
        id: "error",
        when: "request == failed",
        kind: "error",
        requiredRecoveryActions: ["retry"],
        preserveSections: ["page.intro"],
        preserveLastGoodContent: true,
      },
      {
        id: "success",
        when: "request == fulfilled",
        kind: "success",
      },
    ],
  };
  contract.components[0].interactions = [
    {
      id: "primary-cta",
      trigger: "click primary cta",
      effect: "navigate",
      navigationTarget: "#next",
    },
  ];
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validateContractStructure rejects feedback recovery contexts without kind", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    feedbackRecovery: {
      policy: "warn",
    },
    contexts: [
      {
        id: "loading",
        when: "request == pending",
        blockedActionsWhilePending: ["primary-cta"],
      },
    ],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/runtime/contexts/loading must declare kind")),
    `expected feedback context kind validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects feedback recovery requiredStateKinds without matching runtime contexts", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    feedbackRecovery: {
      policy: "warn",
      requiredStateKinds: ["loading", "error"],
    },
    contexts: [
      {
        id: "loading",
        when: "request == pending",
        kind: "loading",
      },
    ],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/runtime/feedbackRecovery/requiredStateKinds/error")),
    `expected feedback requiredStateKinds validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects feedback recovery runtime contexts that reference unknown interaction ids", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    feedbackRecovery: {
      policy: "warn",
    },
    contexts: [
      {
        id: "loading",
        when: "request == pending",
        kind: "loading",
        blockedActionsWhilePending: ["missing-action"],
      },
      {
        id: "empty",
        when: "items.length == 0",
        kind: "empty",
      },
      {
        id: "error",
        when: "request == failed",
        kind: "error",
      },
    ],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/runtime/contexts/loading/blockedActionsWhilePending/missing-action")),
    `expected blockedActionsWhilePending validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects invalid feedback recovery action values", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    feedbackRecovery: {
      policy: "warn",
    },
    contexts: [
      {
        id: "loading",
        when: "request == pending",
        kind: "loading",
      },
      {
        id: "empty",
        when: "items.length == 0",
        kind: "empty",
      },
      {
        id: "error",
        when: "request == failed",
        kind: "error",
        requiredRecoveryActions: ["retry", "reboot"],
      },
    ],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/0/runtime/contexts/2/requiredRecoveryActions/1")),
    `expected recovery action schema validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects duplicate runtime context ids", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].runtime = {
    feedbackRecovery: {
      policy: "warn",
    },
    contexts: [
      {
        id: "loading",
        when: "request == pending",
        kind: "loading",
      },
      {
        id: "loading",
        when: "request == pending again",
        kind: "loading",
      },
      {
        id: "empty",
        when: "items.length == 0",
        kind: "empty",
      },
      {
        id: "error",
        when: "request == failed",
        kind: "error",
      },
    ],
  };
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/reference-target-web/runtime/contexts/loading must use a unique context id")),
    `expected duplicate context id validation error, got ${JSON.stringify(result.errors)}`,
  );
});

test("validateContractStructure rejects authoring metadata on non-web surfaces", async () => {
  const schema = getBundledContractSchema();
  const contract = await loadFixture();
  contract.surfaces[0].type = "cli";
  const result = validateContractStructure(contract, schema);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("/surfaces/0")),
    `expected surface type validation error, got ${JSON.stringify(result.errors)}`,
  );
});
