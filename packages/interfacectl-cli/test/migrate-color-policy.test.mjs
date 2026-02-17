import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");

async function runCli(args, cwd) {
  const proc = spawn("node", [cliPath, ...args], {
    cwd,
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

  const [exitCode] = await once(proc, "exit");
  return {
    exitCode: Number(exitCode),
    stdout,
    stderr,
  };
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

test("migrate-color-policy converts legacy shape and is idempotent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-migrate-color-"));

  try {
    const contractPath = path.join(tempRoot, "contract.json");
    const migratedPath = path.join(tempRoot, "contract.migrated.json");
    const remigratedPath = path.join(tempRoot, "contract.remigrated.json");

    const legacyContract = {
      contractId: "legacy",
      version: "1.0.0",
      surfaces: [
        {
          id: "demo-surface",
          displayName: "Demo",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          allowedColors: ["#FFFFFF", "rgba(15, 23, 42, 0.3)"],
          layout: { maxContentWidth: 1200 },
        },
      ],
      sections: [
        { id: "header", intent: "Header", description: "Header" },
      ],
      constraints: {
        motion: {
          allowedDurationsMs: [200],
          allowedTimingFunctions: ["ease"],
        },
      },
      color: {
        rawValues: {
          policy: "strict",
          allowlist: ["rgb(0, 0, 0)"],
        },
      },
    };

    await writeFile(contractPath, `${JSON.stringify(legacyContract, null, 2)}\n`, "utf8");

    const firstRun = await runCli(
      [
        "migrate-color-policy",
        "--contract",
        "contract.json",
        "--out",
        "contract.migrated.json",
      ],
      tempRoot,
    );

    assert.equal(firstRun.exitCode, 0, firstRun.stderr || firstRun.stdout);

    const migrated = await readJson(migratedPath);
    assert.equal(migrated.color.policy, "strict");
    assert.deepEqual(migrated.color.allowedValues, [
      "#ffffff",
      "rgb(0, 0, 0)",
      "rgba(15, 23, 42, 0.3)",
    ]);
    assert.equal("allowedColors" in migrated.surfaces[0], false);
    assert.equal("rawValues" in migrated.color, false);
    assert.equal("sourceOfTruth" in migrated.color, false);

    const secondRun = await runCli(
      [
        "migrate-color-policy",
        "--contract",
        "contract.migrated.json",
        "--out",
        "contract.remigrated.json",
      ],
      tempRoot,
    );

    assert.equal(secondRun.exitCode, 0, secondRun.stderr || secondRun.stdout);

    const migratedRaw = await readFile(migratedPath, "utf8");
    const remigratedRaw = await readFile(remigratedPath, "utf8");
    assert.equal(remigratedRaw, migratedRaw, "migration should be idempotent");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("migrate-color-policy can include observed colors", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-migrate-observed-"));

  try {
    const contractPath = path.join(tempRoot, "contract.json");
    const outPath = path.join(tempRoot, "contract.observed.json");
    const appRoot = path.join(tempRoot, "apps", "demo-surface", "app");

    await mkdir(appRoot, { recursive: true });

    const contract = {
      contractId: "legacy",
      version: "1.0.0",
      surfaces: [
        {
          id: "demo-surface",
          displayName: "Demo",
          type: "web",
          requiredSections: ["header"],
          allowedFonts: ["Inter"],
          layout: { maxContentWidth: 1200 },
        },
      ],
      sections: [
        { id: "header", intent: "Header", description: "Header" },
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

    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

    await writeFile(
      path.join(appRoot, "layout.tsx"),
      `import "./globals.css";
export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "page.tsx"),
      `export default function Page() {
  return <main data-contract-section="header">Hello</main>;
}
`,
      "utf8",
    );

    await writeFile(
      path.join(appRoot, "globals.css"),
      `.demo {
  color: rgba(10, 20, 30, 0.5);
}
`,
      "utf8",
    );

    const result = await runCli(
      [
        "migrate-color-policy",
        "--contract",
        "contract.json",
        "--out",
        "contract.observed.json",
        "--include-observed",
        "--app-root",
        "apps/demo-surface",
        "--surface",
        "demo-surface",
      ],
      tempRoot,
    );

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);

    const migrated = await readJson(outPath);
    assert.ok(
      migrated.color.allowedValues.includes("rgba(10, 20, 30, 0.5)"),
      `expected observed color in allowlist, got ${JSON.stringify(migrated.color.allowedValues)}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
