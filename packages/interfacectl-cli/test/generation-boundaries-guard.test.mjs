import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const guardPath = path.resolve(testDir, "../../../tools/check-generation-boundaries.mjs");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "generation-boundaries-guard-"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runGuard({ contract, descriptor, format = "json" }) {
  const root = makeTempDir();
  const contractPath = path.join(root, "contract.json");
  const descriptorPath = path.join(root, "descriptor.json");
  writeJson(contractPath, contract);
  writeJson(descriptorPath, descriptor);

  const result = spawnSync(
    process.execPath,
    [guardPath, "--contract", contractPath, "--descriptor", descriptorPath, "--format", format],
    { encoding: "utf8" },
  );

  fs.rmSync(root, { recursive: true, force: true });
  return result;
}

function parseJsonOutput(result) {
  const output = (result.stdout || "").trim();
  assert.ok(output.length > 0, "guard should emit JSON output");
  return JSON.parse(output);
}

function makeCanonicalContract({ iconPolicy = "strict" } = {}) {
  return {
    contractId: "surfaces.web",
    version: "0.1.0",
    surfaces: [
      {
        id: "reference-target-web",
        displayName: "Reference",
        type: "web",
        requiredSections: [],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1120 },
        icons: {
          policy: iconPolicy,
          allowedSources: ["@heroicons/react/24/outline"],
        },
      },
    ],
    sections: [],
    constraints: {
      motion: {
        allowedDurationsMs: [120],
        allowedTimingFunctions: ["linear"],
      },
    },
    color: {
      policy: "strict",
      allowedValues: ["var(--background)"],
    },
  };
}

function makeFlowContract({ policy = "strict" } = {}) {
  return {
    contractId: "surfaces.web",
    version: "0.1.0",
    surfaces: [
      {
        id: "reference-target-web",
        displayName: "Reference",
        type: "web",
        requiredSections: [],
        allowedFonts: ["Inter"],
        layout: { maxContentWidth: 1120 },
        flows: {
          policy,
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
      },
    ],
    sections: [],
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
  };
}

test("json: strict canonical color policy blocks disallowed color", () => {
  const result = runGuard({
    contract: makeCanonicalContract(),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [{ value: "rgba(15, 23, 42, 0.3)", source: "generated.css" }],
        icons: [{ value: "@heroicons/react/24/outline", source: "generated.tsx" }],
      },
    ],
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "block");
  assert.ok(payload.findings.some((finding) => finding.code === "color.disallowed"));
});

test("json: strict icon policy blocks disallowed icon source", () => {
  const result = runGuard({
    contract: makeCanonicalContract({ iconPolicy: "strict" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [{ value: "var(--background)", source: "generated.css" }],
        icons: [{ value: "lucide-react", source: "generated.tsx" }],
      },
    ],
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "block");
  assert.ok(payload.findings.some((finding) => finding.code === "icon.source-disallowed"));
});

test("json: warn icon policy returns warning, non-blocking exit code", () => {
  const result = runGuard({
    contract: makeCanonicalContract({ iconPolicy: "warn" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [{ value: "var(--background)", source: "generated.css" }],
        icons: [{ value: "lucide-react", source: "generated.tsx" }],
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "warn");
  const finding = payload.findings.find((entry) => entry.code === "icon.source-disallowed");
  assert.ok(finding, "expected icon.source-disallowed finding");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.policy, "warn");
});

test("json: strict icon policy emits descriptor.icons.missing when icons are absent", () => {
  const result = runGuard({
    contract: makeCanonicalContract({ iconPolicy: "strict" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [{ value: "var(--background)", source: "generated.css" }],
      },
    ],
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "block");
  assert.ok(payload.findings.some((finding) => finding.code === "descriptor.icons.missing"));
});

test("json: strict flow policy emits descriptor.flows.missing when flows are absent", () => {
  const result = runGuard({
    contract: makeFlowContract({ policy: "strict" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [],
      },
    ],
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "block");
  assert.equal(payload.evaluation.flowPolicyEvaluated, true);
  assert.ok(payload.findings.some((finding) => finding.code === "descriptor.flows.missing"));
});

test("json: warn flow policy emits warnings and stays non-blocking", () => {
  const result = runGuard({
    contract: makeFlowContract({ policy: "warn" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [],
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "warn");
  const finding = payload.findings.find((entry) => entry.code === "descriptor.flows.missing");
  assert.ok(finding, "expected descriptor.flows.missing finding");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.policy, "warn");
});

test("json: strict flow policy enforces steps, transitions, and terminal invariants", () => {
  const result = runGuard({
    contract: makeFlowContract({ policy: "strict" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [],
        flows: [
          {
            flowId: "checkout",
            steps: [{ id: "start" }, { id: "review" }, { id: "done" }],
            transitions: [{ from: "review", to: "done" }],
          },
        ],
      },
    ],
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const payload = parseJsonOutput(result);
  assert.equal(payload.status, "block");
  assert.ok(payload.findings.some((finding) => finding.code === "flow.transition.required"));
  assert.ok(payload.findings.some((finding) => finding.code === "flow.terminal.invalid"));
});

test("text: canonical color/icon checks remain backward-compatible in text mode", () => {
  const result = runGuard({
    contract: makeCanonicalContract({ iconPolicy: "strict" }),
    descriptor: [
      {
        surfaceId: "reference-target-web",
        primitives: [],
        colors: [{ value: "rgba(15, 23, 42, 0.3)", source: "generated.css" }],
        icons: [{ value: "lucide-react", source: "generated.tsx" }],
      },
    ],
    format: "text",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr || "", /icon\.source-disallowed/);
  assert.doesNotMatch(result.stderr || "", /color\.disallowed/);
});
