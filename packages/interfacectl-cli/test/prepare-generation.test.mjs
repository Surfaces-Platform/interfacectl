import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { validateDiffOutput } from "@surfaces/interfacectl-validator";
import prepareGenerationOutputSchema from "../schemas/prepare-generation-output.schema.json" with { type: "json" };

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

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validatePreparedGenerationOutput(payload) {
  return validateDiffOutput(payload, prepareGenerationOutputSchema);
}

function buildContract(overrides = {}) {
  return {
    contractId: "prepare-demo",
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
        requiredSections: ["main.hero"],
        mustNotEmit: ["header"],
        allowedFonts: ["Demo Sans", "sans-serif", "var(--font-demo)"],
        layout: {
          maxContentWidth: 960,
          requiredContainers: ["contract-container"],
        },
        authoring: {
          framework: "next",
          routing: "app-router",
          styling: {
            strategy: "css-modules",
            tokenPrefix: "--demo",
          },
          preferredLibraries: {
            components: ["@surfaces/ui"],
            icons: ["lucide-react"],
          },
          sourcePriority: ["contract", "code"],
        },
        ...overrides.surface,
      },
    ],
    sections: [
      {
        id: "main.hero",
        intent: "primary-intro",
        description: "Demo hero section",
        anatomy: {
          pattern: "hero",
          defaultComponent: "hero-banner",
          allowedComponents: ["hero-banner"],
        },
      },
    ],
    components: [
      {
        id: "hero-banner",
        intent: "hero",
        slots: [
          { id: "title", kind: "text", required: true },
        ],
        implementation: {
          preferredSource: "contract",
        },
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
      allowedValues: ["#ffffff", "#111111"],
    },
    x_extracted: {
      evidenceMarker: "EXTRACTED-SHOULD-STAY-BY-REF",
    },
    ...overrides.contract,
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

function buildDescriptor(overrides = {}) {
  return [
    {
      surfaceId: "demo-surface",
      primitives: [],
      colors: [],
      ...overrides,
    },
  ];
}

test("prepare-generation: emits resolved payload with summary, provenance, authoring, and evidence refs", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-generation-rich-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const result = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.surface.surfaceId, "demo-surface");
    assert.equal(payload.bundle.version, "2.0");
    assert.equal(payload.bundle.manifestPath, path.join(bundleRoot, "manifest.json"));
    assert.equal(payload.bundle.sourcePaths.contract, path.join(bundleRoot, "contract", "normalized.json"));
    assert.equal(payload.contract.id, "prepare-demo");
    assert.equal(payload.contract.version, "1.0.0");
    assert.equal(payload.contract.normalizedPath, path.join(bundleRoot, "contract", "normalized.json"));
    assert.equal(payload.summary.focusOrder[0], "boundary");
    assert.ok(payload.summary.text.includes("Focus on"), "summary should include human-readable text");
    assert.ok(Array.isArray(payload.summary.checklist));
    assert.deepEqual(payload.generation.boundary.shellOwns, ["header", "footer"]);
    assert.equal(payload.sections.length, 1);
    assert.equal(payload.components.length, 1);
    assert.equal(payload.constraints.color.policy, "warn");
    assert.equal(payload.repairMap[0].code, "shell.primitive.disallowed");
    assert.equal(payload.authoring.framework, "next");
    assert.deepEqual(payload.evidenceRefs, [{ kind: "contract-field", path: "/x_extracted" }]);
    const schemaValidation = validatePreparedGenerationOutput(payload);
    assert.equal(
      schemaValidation.ok,
      true,
      `prepare-generation output should satisfy schema: ${JSON.stringify(schemaValidation.errors)}`,
    );

    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes("EXTRACTED-SHOULD-STAY-BY-REF"));
    assert.equal(payload.refs, undefined);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepare-generation: --out writes the payload file and suppresses stdout", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-generation-out-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");
  const outPath = path.join(tempDir, "prepared", "demo-surface.json");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const result = await runCli(
      [
        "prepare-generation",
        "--bundle-root",
        bundleRoot,
        "--surface",
        "demo-surface",
        "--out",
        outPath,
      ],
      tempDir,
    );

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    const written = JSON.parse(await fsp.readFile(outPath, "utf8"));
    assert.equal(written.surface.surfaceId, "demo-surface");
    assert.equal(written.bundle.sourcePaths.generation, path.join(bundleRoot, "surfaces", "demo-surface", "generation.json"));
    const schemaValidation = validatePreparedGenerationOutput(written);
    assert.equal(
      schemaValidation.ok,
      true,
      `written prepare-generation output should satisfy schema: ${JSON.stringify(schemaValidation.errors)}`,
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepare-generation: repeated runs on the same bundle are byte-stable", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-generation-determinism-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const first = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );
    const second = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );

    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepare-generation: rejects missing manifest, unsupported bundle versions, missing surface files, and unreadable normalized contracts", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-generation-errors-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const missingManifestDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-generation-no-manifest-"));
    try {
      const missingManifest = await runCli(
        ["prepare-generation", "--bundle-root", missingManifestDir, "--surface", "demo-surface"],
        tempDir,
      );
      assert.equal(missingManifest.exitCode, 10);
      assert.match(missingManifest.stderr, /Bundle manifest file not found/i);
    } finally {
      await fsp.rm(missingManifestDir, { recursive: true, force: true });
    }

    const missingSurface = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "missing-surface"],
      tempDir,
    );
    assert.equal(missingSurface.exitCode, 10);
    assert.match(missingSurface.stderr, /Surface bundle directory not found/i);

    const manifestPath = path.join(bundleRoot, "manifest.json");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    manifest.bundleVersion = "1.0";
    await writeJson(manifestPath, manifest);
    const unsupported = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );
    assert.equal(unsupported.exitCode, 10);
    assert.match(unsupported.stderr, /Unsupported bundle version/i);

    manifest.bundleVersion = "2.0";
    await writeJson(manifestPath, manifest);
    await fsp.unlink(path.join(bundleRoot, "surfaces", "demo-surface", "sections.json"));
    const missingSibling = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );
    assert.equal(missingSibling.exitCode, 10);
    assert.match(missingSibling.stderr, /sections bundle file not found/i);

    await compileBundle(contractPath, bundleRoot, tempDir);
    await fsp.writeFile(path.join(bundleRoot, "contract", "normalized.json"), "{invalid json", "utf8");
    const unreadableContract = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );
    assert.equal(unreadableContract.exitCode, 10);
    assert.match(unreadableContract.stderr, /Failed to read Compiled contract JSON/i);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepare-generation: integration stays aligned with validate-generation provenance", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-prepare-generation-integration-"));
  const contractPath = path.join(tempDir, "contract.json");
  const descriptorPath = path.join(tempDir, "descriptor.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await writeJson(descriptorPath, buildDescriptor());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const prepared = await runCli(
      ["prepare-generation", "--bundle-root", bundleRoot, "--surface", "demo-surface"],
      tempDir,
    );
    const validated = await runCli(
      [
        "validate-generation",
        "--tool",
        "codex",
        "--surface",
        "demo-surface",
        "--mode",
        "descriptor",
        "--bundle-root",
        bundleRoot,
        "--descriptor-path",
        descriptorPath,
      ],
      tempDir,
    );

    assert.equal(prepared.exitCode, 0, prepared.stderr);
    assert.equal(validated.exitCode, 0, validated.stderr);

    const preparedPayload = JSON.parse(prepared.stdout);
    const validatedPayload = JSON.parse(validated.stdout);

    assert.equal(preparedPayload.bundle.version, validatedPayload.bundle.version);
    assert.equal(preparedPayload.bundle.manifestPath, validatedPayload.bundle.manifestPath);
    assert.equal(preparedPayload.contract.id, validatedPayload.contract.id);
    assert.equal(preparedPayload.contract.version, validatedPayload.contract.version);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});
