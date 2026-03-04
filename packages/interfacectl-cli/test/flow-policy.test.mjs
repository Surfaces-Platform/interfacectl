import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliExecutable = path.resolve(__dirname, "..", "dist", "index.js");

async function runValidate(workspaceRoot, contractPath) {
  const child = spawn(
    "node",
    [
      cliExecutable,
      "validate",
      "--contract",
      contractPath,
      "--workspace-root",
      workspaceRoot,
      "--format",
      "json",
      "--exit-codes",
      "v2",
    ],
    { cwd: workspaceRoot },
  );

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

async function createWorkspace({ flowPolicy = "strict", includeFlowDescriptor = true, malformedFlowDescriptor = false } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-flow-policy-"));
  const surfaceId = "test-surface";
  const appDir = path.join(tempRoot, "apps", surfaceId, "app");
  const generatedDir = path.join(tempRoot, "contracts", "generated");
  const contractPath = path.join(tempRoot, "contract.json");

  await mkdir(appDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });

  await writeFile(
    path.join(tempRoot, "interfacectl.config.json"),
    JSON.stringify(
      {
        surfaceRoots: {
          [surfaceId]: `apps/${surfaceId}`,
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  await writeFile(
    path.join(appDir, "layout.tsx"),
    `
      import "./globals.css";
      export default function Layout({ children }) {
        return <html><body className="contract-container">{children}</body></html>;
      }
    `,
    "utf-8",
  );

  await writeFile(
    path.join(appDir, "page.tsx"),
    `
      export default function Page() {
        return (
          <main data-contract-section="main.hero" className="contract-container">
            <h1>Flow policy test</h1>
          </main>
        );
      }
    `,
    "utf-8",
  );

  await writeFile(
    path.join(appDir, "globals.css"),
    `
      :root {
        --contract-max-width: 960px;
        --contract-motion-duration: 120ms;
        --contract-motion-timing: linear;
      }
      body {
        font-family: sans-serif;
      }
      .contract-container {
        transition: opacity var(--contract-motion-duration) var(--contract-motion-timing);
      }
    `,
    "utf-8",
  );

  const contract = {
    contractId: "flow-policy-test",
    version: "1.0.0",
    surfaces: [
      {
        id: surfaceId,
        displayName: "Flow Surface",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["sans-serif"],
        layout: { maxContentWidth: 960 },
        flows: {
          policy: flowPolicy,
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
    sections: [{ id: "main.hero", intent: "Hero", description: "Main hero section" }],
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

  await writeFile(contractPath, JSON.stringify(contract, null, 2), "utf-8");

  if (includeFlowDescriptor) {
    const flowDescriptorPath = path.join(generatedDir, `${surfaceId}.flow-descriptor.json`);
    if (malformedFlowDescriptor) {
      await writeFile(flowDescriptorPath, "{\n  invalid-json\n", "utf-8");
    } else {
      await writeFile(
        flowDescriptorPath,
        JSON.stringify(
          [
            {
              flowId: "checkout",
              steps: [{ id: "start" }, { id: "review" }],
              transitions: [{ from: "start", to: "review" }],
              source: "contracts/generated/test-surface.flow-descriptor.json",
            },
          ],
          null,
          2,
        ),
        "utf-8",
      );
    }
  }

  return { tempRoot, contractPath };
}

test("validate: strict flow policy passes when compliant flow descriptor artifact exists", async () => {
  const { tempRoot, contractPath } = await createWorkspace({
    flowPolicy: "strict",
    includeFlowDescriptor: true,
  });
  try {
    const result = await runValidate(tempRoot, contractPath);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.summary.errors, 0);
    assert.equal(
      payload.findings.some((entry) => entry.code.startsWith("flow.")),
      false,
      `unexpected flow findings: ${result.stdout}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate: warn flow policy emits descriptor.flows.missing warning when artifact is missing", async () => {
  const { tempRoot, contractPath } = await createWorkspace({
    flowPolicy: "warn",
    includeFlowDescriptor: false,
  });
  try {
    const result = await runValidate(tempRoot, contractPath);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const finding = payload.findings.find(
      (entry) => entry.code === "descriptor.flows.missing",
    );
    assert.ok(finding, `missing descriptor.flows.missing finding: ${result.stdout}`);
    assert.equal(finding.severity, "warning");
    assert.equal(finding.category, "E2");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate: strict flow policy blocks when flow descriptor artifact is missing", async () => {
  const { tempRoot, contractPath } = await createWorkspace({
    flowPolicy: "strict",
    includeFlowDescriptor: false,
  });
  try {
    const result = await runValidate(tempRoot, contractPath);
    assert.equal(result.exitCode, 30, result.stderr);
    const payload = JSON.parse(result.stdout);
    const finding = payload.findings.find(
      (entry) => entry.code === "descriptor.flows.missing",
    );
    assert.ok(finding, `missing descriptor.flows.missing finding: ${result.stdout}`);
    assert.equal(finding.severity, "error");
    assert.equal(finding.category, "E2");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate: malformed flow descriptor artifact returns E0", async () => {
  const { tempRoot, contractPath } = await createWorkspace({
    flowPolicy: "strict",
    includeFlowDescriptor: true,
    malformedFlowDescriptor: true,
  });
  try {
    const result = await runValidate(tempRoot, contractPath);
    assert.equal(result.exitCode, 10, result.stderr);
    const payload = JSON.parse(result.stdout);
    const finding = payload.findings.find(
      (entry) => entry.code === "flow-descriptor.load-error",
    );
    assert.ok(finding, `missing flow-descriptor.load-error finding: ${result.stdout}`);
    assert.equal(finding.severity, "error");
    assert.equal(finding.category, "E0");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
