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

/**
 * Creates a minimal valid workspace for testing.
 * @param {string} tempRoot - Root directory for the workspace
 * @param {object} contract - Contract object to write
 * @param {string} surfaceId - Surface ID to create directory for
 * @returns {Promise<string>} Path to the workspace root
 */
async function createTempWorkspace(tempRoot, contract, surfaceId) {
  // Write contract file
  const contractPath = path.join(tempRoot, "contract.json");
  await writeFile(contractPath, JSON.stringify(contract, null, 2), "utf-8");

  // Create surface directory structure
  const surfaceDir = path.join(tempRoot, "apps", surfaceId);
  await mkdir(surfaceDir, { recursive: true });
  await writeFile(
    path.join(surfaceDir, "package.json"),
    JSON.stringify({ name: surfaceId }),
    "utf-8"
  );

  // Create app directory with analysable files
  const appDir = path.join(surfaceDir, "app");
  await mkdir(appDir, { recursive: true });

  // Get contract requirements
  const surface = contract.surfaces[0];
  const firstSection = surface?.requiredSections?.[0] || "header";
  const maxWidth = surface?.layout?.maxContentWidth || 1200;
  const allowedFonts = surface?.allowedFonts || ["Inter", "sans-serif"];
  const allowedColors = surface?.allowedColors || [];
  const motionDuration = contract.constraints?.motion?.allowedDurationsMs?.[0] || 200;
  const motionTiming = contract.constraints?.motion?.allowedTimingFunctions?.[0] || "ease";

  // Choose a color value - prefer first allowed color, or use CSS variable
  const colorValue = allowedColors.length > 0
    ? allowedColors[0]
    : "var(--color-background)";

  // Create globals.css with all required declarations
  await writeFile(
    path.join(appDir, "globals.css"),
    `:root {
  --contract-max-width: ${maxWidth}px;
  --contract-motion-duration: ${motionDuration}ms;
  --contract-motion-timing: ${motionTiming};
  --color-background: #ffffff;
}

body {
  font-family: ${allowedFonts.map(f => f.startsWith("var(") ? f : `"${f}"`).join(", ")};
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

  // Create layout.tsx with contract-container marker
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

  // Create page.tsx with section marker
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

test("validate emits deprecation warning for allowedColors", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-deprecation-"),
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
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const contractPath = path.join(tempRoot, "contract.json");
    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        contractPath,
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    // Should pass schema validation (allowedColors is accepted but deprecated)
    assert.equal(
      result.exitCode,
      0,
      `Command failed: ${result.stderr}\n${result.stdout}`
    );

    const output = JSON.parse(result.stdout);
    assert.ok(output.findings);

    // Should have at least one deprecation warning
    assert.ok(
      output.summary.warnings >= 1,
      `Expected at least 1 warning, got ${output.summary.warnings}`
    );

    // Should have deprecation warning
    const deprecationFinding = output.findings.find(
      (f) => f.code === "contract.deprecated-field",
    );
    assert.ok(
      deprecationFinding,
      "Should emit contract.deprecated-field finding"
    );
    assert.equal(deprecationFinding.severity, "warning");
    assert(
      deprecationFinding.message.includes("allowedColors"),
      "Deprecation message should mention allowedColors"
    );
    assert(
      deprecationFinding.message.includes("deprecated"),
      "Deprecation message should mention deprecated"
    );
    assert.ok(
      deprecationFinding.location,
      "Should include jsonPointer location"
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("validate accepts contract with color policy", async () => {
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
      color: {
        sourceOfTruth: {
          type: "tokens",
          tokenNamespaces: ["--color-"],
        },
        rawValues: {
          policy: "warn",
        },
      },
    };

    await createTempWorkspace(tempRoot, contract, "test-surface");

    const contractPath = path.join(tempRoot, "contract.json");
    const result = await runCommand(
      "node",
      [
        cliExecutable,
        "validate",
        "--contract",
        contractPath,
        "--workspace-root",
        tempRoot,
        "--format",
        "json",
        "--exit-codes",
        "v2",
      ],
      { cwd: tempRoot },
    );

    // Should pass schema validation
    assert.equal(
      result.exitCode,
      0,
      `Command failed: ${result.stderr}\n${result.stdout}`
    );

    const output = JSON.parse(result.stdout);

    // Assert there are no contract.schema-error findings
    const schemaErrors = output.findings.filter(
      (f) => f.code === "contract.schema-error"
    );
    assert.equal(
      schemaErrors.length,
      0,
      `Expected no schema errors, got: ${JSON.stringify(schemaErrors, null, 2)}`
    );

    // Optionally assert the contract is accepted and surfaces validate
    assert.equal(
      output.summary.errors,
      0,
      `Expected no errors, got: ${output.summary.errors}`
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
