import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import os from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPackageDir = path.resolve(__dirname, "..");
const cliExecutable = path.resolve(cliPackageDir, "dist", "index.js");
const requiredColorPolicy = {
  policy: "off",
  allowedValues: [],
};

async function createTempWorkspace(tempRoot, contract, surfaceId) {
  const contractPath = path.join(tempRoot, "contract.json");
  await writeFile(contractPath, JSON.stringify(contract, null, 2), "utf-8");

  const surfaceDir = path.join(tempRoot, "apps", surfaceId);
  await mkdir(surfaceDir, { recursive: true });
  await writeFile(
    path.join(surfaceDir, "package.json"),
    JSON.stringify({ name: surfaceId }),
    "utf-8"
  );

  const appDir = path.join(surfaceDir, "app");
  await mkdir(appDir, { recursive: true });

  const surface = contract.surfaces[0];
  const firstSection = surface?.requiredSections?.[0] || "header";
  const maxWidth = surface?.layout?.maxContentWidth || 1200;
  const allowedFonts = surface?.allowedFonts || ["Inter", "sans-serif"];
  const motionDuration = contract.constraints?.motion?.allowedDurationsMs?.[0] || 200;
  const motionTiming = contract.constraints?.motion?.allowedTimingFunctions?.[0] || "ease";
  const colorValue = contract.color?.allowedValues?.[0] || "var(--color-background)";

  await writeFile(
    path.join(appDir, "globals.css"),
    `:root {
  --contract-max-width: ${maxWidth}px;
  --contract-motion-duration: ${motionDuration}ms;
  --contract-motion-timing: ${motionTiming};
  --color-background: #ffffff;
}

body {
  font-family: ${allowedFonts.map((f) => (f.startsWith("var(") ? f : `"${f}"`)).join(", ")};
  color: ${colorValue};
  background: ${colorValue};
}

.contract-container {
  max-width: var(--contract-max-width);
  transition: opacity var(--contract-motion-duration) var(--contract-motion-timing);
  animation-duration: var(--contract-motion-duration);
  animation-timing-function: var(--contract-motion-timing);
}
`,
    "utf-8"
  );

  await writeFile(
    path.join(appDir, "layout.tsx"),
    `import "./globals.css";

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="contract-container">{children}</div>
      </body>
    </html>
  );
}
`,
    "utf-8"
  );

  await writeFile(
    path.join(appDir, "page.tsx"),
    `export default function Page() {
  return (
    <main className="contract-container" data-contract-section="${firstSection}">
      <h1>Test</h1>
    </main>
  );
}
`,
    "utf-8"
  );

  return tempRoot;
}

async function runCommand(command, args, options = {}) {
  const proc = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await once(proc, "exit").then(([code]) => code ?? 1);

  return { exitCode, stdout, stderr };
}

test("validate rejects legacy color fields and per-surface allowedColors", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-legacy-color-shape-"),
  );

  try {
    const contract = {
      contractId: "test",
      version: "1.0.0",
      surfaces: [
        {
          id: "test-surface",
          displayName: "Test Surface",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          allowedColors: ["#000000", "#ffffff"],
          layout: {
            maxContentWidth: 1200,
          },
        },
      ],
      sections: [
        {
          id: "header",
          intent: "Page header",
          description: "Main header",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [200],
          allowedTimingFunctions: ["ease"],
        },
      },
      color: {
        sourceOfTruth: {
          type: "tokens",
          tokenNamespaces: ["--color-"],
        },
        rawValues: {
          policy: "warn",
          allowlist: [],
          denylist: [],
        },
      },
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        path.join(tempRoot, "contract.json"),
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    assert.equal(result.exitCode, 10);

    const output = JSON.parse(result.stdout);
    assert.ok(
      output.findings.some((f) => f.message.includes("allowedColors")),
      "should reject legacy surfaces[*].allowedColors"
    );
    assert.ok(
      output.findings.some((f) => f.message.includes("sourceOfTruth")),
      "should reject legacy color.sourceOfTruth"
    );
    assert.ok(
      output.findings.some((f) => f.message.includes("rawValues")),
      "should reject legacy color.rawValues"
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate accepts contract with unified color policy", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-color-policy-"),
  );

  try {
    const contract = {
      contractId: "test",
      version: "1.0.0",
      surfaces: [
        {
          id: "test-surface",
          displayName: "Test Surface",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 1200,
          },
        },
      ],
      sections: [
        {
          id: "header",
          intent: "Page header",
          description: "Main header",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [200],
          allowedTimingFunctions: ["ease"],
        },
      },
      color: requiredColorPolicy,
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        path.join(tempRoot, "contract.json"),
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    assert.equal(result.exitCode, 0, `Command failed: ${result.stderr}\n${result.stdout}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.summary.errors, 0);
    assert.equal(output.summary.warnings, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate warns with color.disallowed when policy is warn", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-color-warn-"),
  );

  try {
    const contract = {
      contractId: "test",
      version: "1.0.0",
      surfaces: [
        {
          id: "test-surface",
          displayName: "Test Surface",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 1200,
          },
        },
      ],
      sections: [
        {
          id: "header",
          intent: "Page header",
          description: "Main header",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [200],
          allowedTimingFunctions: ["ease"],
        },
      },
      color: {
        policy: "warn",
        allowedValues: [],
      },
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        path.join(tempRoot, "contract.json"),
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    assert.equal(result.exitCode, 0, `warn policy should not fail: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    const finding = output.findings.find((f) => f.code === "color.disallowed");
    assert.ok(finding, "should emit color.disallowed finding");
    assert.equal(finding.severity, "warning");
    assert.equal(finding.category, "E1");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate rejects contract missing color.policy", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-missing-color-policy-"),
  );

  try {
    const contract = {
      contractId: "test",
      version: "1.0.0",
      surfaces: [
        {
          id: "test-surface",
          displayName: "Test Surface",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 1200,
          },
        },
      ],
      sections: [
        {
          id: "header",
          intent: "Page header",
          description: "Main header",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [200],
          allowedTimingFunctions: ["ease"],
        },
      },
      color: {
        allowedValues: [],
      },
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        path.join(tempRoot, "contract.json"),
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    assert.equal(result.exitCode, 10);

    const output = JSON.parse(result.stdout);
    const schemaErrors = output.findings.filter((f) => f.code.startsWith("contract.schema"));
    assert.ok(
      schemaErrors.some((f) => f.message.includes("policy")),
      `Expected missing policy error, got: ${JSON.stringify(schemaErrors)}`
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate rejects contract missing color.allowedValues", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-missing-color-allowlist-"),
  );

  try {
    const contract = {
      contractId: "test",
      version: "1.0.0",
      surfaces: [
        {
          id: "test-surface",
          displayName: "Test Surface",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          layout: {
            maxContentWidth: 1200,
          },
        },
      ],
      sections: [
        {
          id: "header",
          intent: "Page header",
          description: "Main header",
        },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [200],
          allowedTimingFunctions: ["ease"],
        },
      },
      color: {
        policy: "warn",
      },
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        path.join(tempRoot, "contract.json"),
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    assert.equal(result.exitCode, 10);

    const output = JSON.parse(result.stdout);
    const schemaErrors = output.findings.filter((f) => f.code.startsWith("contract.schema"));
    assert.ok(
      schemaErrors.some((f) => f.message.includes("allowedValues")),
      `Expected missing allowedValues error, got: ${JSON.stringify(schemaErrors)}`
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
