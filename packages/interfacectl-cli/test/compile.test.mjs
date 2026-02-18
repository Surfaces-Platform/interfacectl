import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import os from "node:os";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const fixtureDir = path.resolve(__dirname, "fixtures", "compile");
const contractPath = path.join(fixtureDir, "contract", "ui.contract.json");
const expectedDir = path.join(fixtureDir, "expected");

async function runCompile(contract, outDir, schemaPath = undefined) {
  const args = [
    "compile",
    "--contract",
    contract,
    "--out",
    outDir,
  ];
  if (schemaPath) {
    args.push("--schema", schemaPath);
  }
  const child = spawn("node", [cliPath, ...args], {
    env: process.env,
    cwd: path.dirname(contract),
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });

  const [exitCode] = await once(child, "exit");
  return {
    exitCode: Number(exitCode),
    stdout,
    stderr,
  };
}

async function readJson(p) {
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw);
}

test("compile: structure - required files exist and no extra files", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-structure-"));
  try {
    const result = await runCompile(contractPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const manifest = await readJson(path.join(outDir, "manifest.json"));
    assert.equal(manifest.bundleVersion, "1.0");
    assert.equal(manifest.contractId, "demo-ui");
    assert.equal(manifest.contractVersion, "1.0.0");
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.files.length >= 3);

    const paths = manifest.files.map((f) => f.path);
    assert.ok(paths.includes("contract.normalized.json"), "bundle must include contract.normalized.json");
    assert.ok(paths.includes("surfaces/demo-surface.json"), "bundle must include surfaces/demo-surface.json");
    assert.ok(paths.includes("constraints/motion.json"), "bundle must include constraints/motion.json");

    for (const entry of manifest.files) {
      assert.ok(!entry.path.includes("manifest.json"), "files must not include manifest.json");
      assert.match(entry.sha256, /^[a-f0-9]{64}$/, `sha256 for ${entry.path} must be 64 hex chars`);
    }

    const sortedPaths = [...paths].sort();
    assert.deepEqual(paths, sortedPaths, "manifest.files must be sorted by path");

    const contractNorm = path.join(outDir, "contract.normalized.json");
    const contractStat = await stat(contractNorm);
    assert.ok(contractStat.isFile(), "contract.normalized.json must be a file");

    const surfacesDir = path.join(outDir, "surfaces");
    const surfacesStat = await stat(surfacesDir);
    assert.ok(surfacesStat.isDirectory(), "surfaces/ must exist");
    const surfaceFiles = await readdir(surfacesDir);
    assert.ok(surfaceFiles.includes("demo-surface.json"), "surfaces/ must contain demo-surface.json");

    const constraintsDir = path.join(outDir, "constraints");
    const constraintsStat = await stat(constraintsDir);
    assert.ok(constraintsStat.isDirectory(), "constraints/ must exist");
    const motionPath = path.join(constraintsDir, "motion.json");
    const motionStat = await stat(motionPath);
    assert.ok(motionStat.isFile(), "constraints/motion.json must exist");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: determinism - two runs produce identical manifest.files", async () => {
  const out1 = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-a-"));
  const out2 = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-b-"));
  try {
    const r1 = await runCompile(contractPath, out1);
    const r2 = await runCompile(contractPath, out2);
    assert.equal(r1.exitCode, 0, `first run should exit 0: ${r1.stderr}`);
    assert.equal(r2.exitCode, 0, `second run should exit 0: ${r2.stderr}`);

    const manifest1 = await readJson(path.join(out1, "manifest.json"));
    const manifest2 = await readJson(path.join(out2, "manifest.json"));

    assert.deepEqual(
      manifest1.files,
      manifest2.files,
      "Two runs must produce identical manifest.files (paths and sha256)",
    );
  } finally {
    await rm(out1, { recursive: true, force: true });
    await rm(out2, { recursive: true, force: true });
  }
});

test("compile: golden - generated contract.normalized.json and surface/constraint files match expected", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-golden-"));
  try {
    const result = await runCompile(contractPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const expectedContract = await readJson(path.join(expectedDir, "contract.normalized.json"));
    const generatedContract = await readJson(path.join(outDir, "contract.normalized.json"));
    assert.deepEqual(generatedContract, expectedContract, "contract.normalized.json must match expected");

    const expectedSurface = await readJson(path.join(expectedDir, "surfaces", "demo-surface.json"));
    const generatedSurface = await readJson(path.join(outDir, "surfaces", "demo-surface.json"));
    assert.deepEqual(generatedSurface, expectedSurface, "surfaces/demo-surface.json must match expected");

    const expectedMotion = await readJson(path.join(expectedDir, "constraints", "motion.json"));
    const generatedMotion = await readJson(path.join(outDir, "constraints", "motion.json"));
    assert.deepEqual(generatedMotion, expectedMotion, "constraints/motion.json must match expected");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: includes surface icons policy when present in contract", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-icons-"));
  const contractWithIconsPath = path.join(outDir, "contract-with-icons.json");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      contractWithIconsPath,
      JSON.stringify(
        {
          contractId: "demo-ui-icons",
          version: "1.0.0",
          surfaces: [
            {
              id: "demo-surface",
              displayName: "Demo Surface",
              type: "web",
              requiredSections: ["main.hero"],
              allowedFonts: ["Inter"],
              layout: { maxContentWidth: 960 },
              icons: {
                policy: "warn",
                allowedSources: ["lucide-react"],
              },
            },
          ],
          sections: [
            { id: "main.hero", intent: "Hero", description: "Main hero" },
          ],
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
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCompile(contractWithIconsPath, outDir);
    assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);

    const generatedSurface = await readJson(
      path.join(outDir, "surfaces", "demo-surface.json"),
    );
    assert.deepEqual(generatedSurface.icons, {
      policy: "warn",
      allowedSources: ["lucide-react"],
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: invalid contract fails with non-zero exit", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-fail-"));
  const invalidContract = path.join(outDir, "invalid.json");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      invalidContract,
      JSON.stringify({
        contractId: "bad",
        version: "1.0.0",
        surfaces: [],
        sections: [],
        constraints: {},
      }, null, 2),
      "utf8",
    );
    const result = await runCompile(invalidContract, outDir);
    assert.notEqual(result.exitCode, 0, "invalid contract must cause non-zero exit");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("compile: missing required field (constraints) fails", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "interfacectl-compile-fail2-"));
  const badContract = path.join(outDir, "bad.json");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      badContract,
      JSON.stringify({
        contractId: "bad",
        version: "1.0.0",
        surfaces: [{ id: "x", displayName: "X", type: "web", requiredSections: [], allowedFonts: [], layout: { maxContentWidth: 100 } }],
        sections: [],
      }, null, 2),
      "utf8",
    );
    const result = await runCompile(badContract, outDir);
    assert.notEqual(result.exitCode, 0, "contract missing required constraints must fail");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
