import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";

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

async function createWorkspace(policy) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-icon-policy-"));
  const surfaceId = "test-surface";
  const appDir = path.join(tempRoot, "apps", surfaceId, "app");
  const contractPath = path.join(tempRoot, "contract.json");

  await mkdir(appDir, { recursive: true });

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
      import { BellIcon } from "@heroicons/react/24/outline";
      export default function Page() {
        return (
          <main data-contract-section="main.hero" className="contract-container">
            <BellIcon />
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
    contractId: "icon-policy-test",
    version: "1.0.0",
    surfaces: [
      {
        id: surfaceId,
        displayName: "Test Surface",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["sans-serif"],
        layout: { maxContentWidth: 960 },
        icons: {
          policy,
          allowedSources: ["lucide-react"],
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
  return { tempRoot, contractPath };
}

test("validate emits icon.source-disallowed as warning when policy is warn", async () => {
  const { tempRoot, contractPath } = await createWorkspace("warn");
  try {
    const result = await runValidate(tempRoot, contractPath);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const finding = payload.findings.find(
      (entry) => entry.code === "icon.source-disallowed",
    );
    assert.ok(finding, `missing icon finding: ${result.stdout}`);
    assert.equal(finding.severity, "warning");
    assert.equal(finding.category, "E1");
    assert.deepEqual(finding.expected, ["lucide-react"]);
    assert.equal(finding.found, "@heroicons/react/24/outline");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate emits icon.source-disallowed as error when policy is strict", async () => {
  const { tempRoot, contractPath } = await createWorkspace("strict");
  try {
    const result = await runValidate(tempRoot, contractPath);
    assert.equal(result.exitCode, 20, result.stderr);
    const payload = JSON.parse(result.stdout);
    const finding = payload.findings.find(
      (entry) => entry.code === "icon.source-disallowed",
    );
    assert.ok(finding, `missing icon finding: ${result.stdout}`);
    assert.equal(finding.severity, "error");
    assert.equal(finding.category, "E1");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
