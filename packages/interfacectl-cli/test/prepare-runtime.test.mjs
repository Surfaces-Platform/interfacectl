import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { validateDiffOutput } from "@surfaces/interfacectl-validator";
import prepareRuntimeOutputSchema from "../schemas/prepare-runtime-output.schema.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.resolve(__dirname, "..", "dist", "index.js");

async function runCli(args, cwd = __dirname) {
  const child = spawn("node", [cliPath, ...args], {
    cwd,
    env: process.env,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [exitCode] = await once(child, "exit");
  return {
    exitCode: Number(exitCode),
    stdout,
    stderr,
  };
}

function parseJsonFromOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output but received an empty string");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // Keep scanning until we find the trailing JSON payload.
      }
    }

    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (char !== "{" && char !== "[") {
        continue;
      }

      try {
        return JSON.parse(trimmed.slice(index));
      } catch {
        // Keep scanning until we find a complete JSON payload.
      }
    }
  }

  throw new Error(`Unable to parse JSON output: ${trimmed}`);
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildContract() {
  return {
    contractId: "runtime-demo",
    version: "1.0.0",
    shell: {
      owns: ["header", "footer"],
      contentSlot: "main-content",
    },
    surfaces: [
      {
        id: "demo-surface",
        displayName: "Demo Surface",
        type: "web",
        owner: "designers@example.com",
        requiredSections: ["main.hero"],
        mustNotEmit: ["header"],
        allowedFonts: ["Demo Sans", "sans-serif"],
        layout: {
          maxContentWidth: 960,
          requiredContainers: ["contract-container"],
          targetAcquisition: {
            policy: "warn",
            modality: "touch-mouse",
            minHitAreaPx: 44,
            minGapPx: 8,
            minEdgeInsetPx: 8,
            destructiveGapPx: 16,
          },
        },
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
        governance: {
          status: "published",
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
        },
        runtime: {
          policy: "strict",
          feedbackRecovery: {
            policy: "warn",
            requiredStateKinds: ["loading", "empty", "error", "success"],
          },
          mutationEnvelope: {
            mode: "slot-bound",
            scopes: ["content", "components"],
            allowedActions: ["update-copy", "swap-variant"],
            allowedSections: ["main.hero"],
          },
          contexts: [
            {
              id: "launch",
              when: "route == '/'",
              policy: "warn",
              requiredSections: ["main.hero"],
            },
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
              requiredRecoveryActions: ["retry"],
            },
            {
              id: "success",
              when: "request == fulfilled",
              kind: "success",
            },
          ],
        },
      },
    ],
    sections: [
      {
        id: "main.hero",
        intent: "primary-intro",
        description: "Demo hero section",
      },
    ],
    components: [
      {
        id: "hero-banner",
        intent: "hero",
        slots: [
          { id: "title", kind: "text", required: true },
        ],
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
    x_extracted: {
      evidenceMarker: "runtime-evidence",
    },
  };
}

async function compileBundle(contractPath, outDir, cwd = path.dirname(contractPath)) {
  const result = await runCli(
    ["compile", "--contract", contractPath, "--out", outDir],
    cwd,
  );
  assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);
  return outDir;
}

test("prepare-runtime: emits resolved runtime payload with governance and enforcement data", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-runtime-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const result = await runCli(
      ["prepare-runtime", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = parseJsonFromOutput(result.stdout);

    assert.equal(payload.surface.surfaceId, "demo-surface");
    assert.equal(payload.bundle.version, "3.0");
    assert.equal(payload.bundle.sourcePaths.ast, path.join(bundleRoot, "ast", "normalized.json"));
    assert.equal(payload.bundle.sourcePaths.contract, path.join(bundleRoot, "derived", "contract.normalized.json"));
    assert.equal(payload.bundle.sourcePaths.astSlice, path.join(bundleRoot, "surfaces", "demo-surface", "ast.json"));
    assert.equal(payload.bundle.sourcePaths.platforms, path.join(bundleRoot, "surfaces", "demo-surface", "platforms.json"));
    assert.equal(payload.bundle.sourcePaths.runtime, path.join(bundleRoot, "surfaces", "demo-surface", "runtime.json"));
    assert.equal(payload.contract.normalizedPath, path.join(bundleRoot, "derived", "contract.normalized.json"));
    assert.equal(payload.ast.normalizedPath, path.join(bundleRoot, "ast", "normalized.json"));
    assert.equal(payload.summary.mutationMode, "slot-bound");
    assert.deepEqual(payload.summary.strictCategories, ["boundary", "runtime", "structure"]);
    assert.equal(payload.governance.owner, "designers@example.com");
    assert.equal(payload.governance.status, "published");
    assert.equal(payload.runtime.policy, "strict");
    assert.deepEqual(payload.runtime.feedbackRecovery.requiredStateKinds, [
      "loading",
      "empty",
      "error",
      "success",
    ]);
    assert.deepEqual(payload.runtime.structure.requiredSections, ["main.hero"]);
    assert.equal(payload.runtime.interaction.targetAcquisition.minHitAreaPx, 44);
    assert.ok(
      payload.summary.checklist.some((item) => item.id === "target-acquisition"),
      "runtime summary should include target acquisition checklist item",
    );
    assert.ok(
      payload.summary.checklist.some((item) => item.id === "feedback-recovery"),
      "runtime summary should include feedback recovery checklist item",
    );
    assert.ok(
      payload.summary.checklist.some((item) => item.id === "flows"),
      "runtime summary should include flow checklist item",
    );
    assert.deepEqual(payload.evidenceRefs, [{ kind: "contract-field", path: "/x_extracted" }]);

    const schemaValidation = validateDiffOutput(payload, prepareRuntimeOutputSchema);
    assert.equal(
      schemaValidation.ok,
      true,
      `prepare-runtime output should satisfy schema: ${JSON.stringify(schemaValidation.errors)}`,
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepare-runtime: fails with adapter error when runtime bundle is missing", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-runtime-missing-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);
    await fsp.rm(path.join(bundleRoot, "surfaces", "demo-surface", "runtime.json"));

    const result = await runCli(
      ["prepare-runtime", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );

    assert.equal(result.exitCode, 10, result.stderr);
    const payload = parseJsonFromOutput(result.stderr);
    assert.equal(payload.code, "adapter.bundle.runtime-missing");
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});
