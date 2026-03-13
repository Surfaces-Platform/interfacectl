import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const corePath = path.resolve(__dirname, "..", "dist", "adapter", "core.js");
const serverCommandPath = path.resolve(
  __dirname,
  "..",
  "dist",
  "commands",
  "serve-generation-adapter.js",
);
const minimalProjectRoot = path.resolve(__dirname, "fixtures", "minimal-project");
const minimalProjectContract = path.join(minimalProjectRoot, "contracts", "ui.contract.json");

async function importDist(modulePath) {
  return import(pathToFileURL(modulePath).href);
}

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

async function compileBundle(contractPath, outDir, cwd = path.dirname(contractPath)) {
  const result = await runCli(
    ["compile", "--contract", contractPath, "--out", outDir],
    cwd,
  );
  assert.equal(result.exitCode, 0, `compile should exit 0: ${result.stderr}`);
  return outDir;
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildContract(overrides = {}) {
  return {
    contractId: "adapter-demo",
    version: "1.0.0",
    surfaces: [
      {
        id: "demo-surface",
        displayName: "Demo Surface",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["Demo Sans", "sans-serif", "var(--font-demo)"],
        layout: {
          maxContentWidth: 960,
        },
        ...overrides.surface,
      },
    ],
    sections: [
      {
        id: "main.hero",
        intent: "primary-intro",
        description: "Demo hero section",
      },
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
    ...overrides.contract,
  };
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

test("generation adapter: workspace mode uses contract/normalized.json from the bundle", async () => {
  const { runGenerationAdapter } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-workspace-"));
  const contractCopyPath = path.join(tempDir, "ui.contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await fsp.copyFile(minimalProjectContract, contractCopyPath);
    await compileBundle(contractCopyPath, bundleRoot, tempDir);
    await fsp.writeFile(contractCopyPath, "{invalid json", "utf8");

    const response = await runGenerationAdapter({
      tool: "codex",
      surfaceId: "demo-surface",
      mode: "workspace",
      bundleRoot,
      workspaceRoot: minimalProjectRoot,
    });

    assert.equal(response.status, "pass");
    assert.equal(response.contract.id, "portable.fixture");
    assert.equal(response.bundle.version, "2.0");
    assert.equal(
      response.bundle.manifestPath,
      path.join(bundleRoot, "manifest.json"),
    );
    assert.equal(
      response.bundle.surfacePath,
      path.join(bundleRoot, "surfaces", "demo-surface", "generation.json"),
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter: descriptor mode loads a valid bundle and returns bundle provenance", async () => {
  const { runGenerationAdapter } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-descriptor-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    const response = await runGenerationAdapter({
      tool: "cursor",
      surfaceId: "demo-surface",
      mode: "descriptor",
      bundleRoot,
      descriptor: buildDescriptor(),
    });

    assert.equal(response.status, "pass");
    assert.equal(response.contract.id, "adapter-demo");
    assert.equal(response.contract.version, "1.0.0");
    assert.equal(response.bundle.version, "2.0");
    assert.equal(response.findings.length, 0);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter: rejects missing bundle manifest", async () => {
  const { runGenerationAdapter, AdapterInputError } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-missing-manifest-"));

  try {
    await assert.rejects(
      runGenerationAdapter({
        tool: "codex",
        surfaceId: "demo-surface",
        mode: "descriptor",
        bundleRoot: tempDir,
        descriptor: buildDescriptor(),
      }),
      (error) =>
        error instanceof AdapterInputError &&
        /Bundle manifest file not found/.test(error.message),
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter: rejects unsupported bundle version", async () => {
  const { runGenerationAdapter, AdapterInputError } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-bundle-version-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);
    const manifestPath = path.join(bundleRoot, "manifest.json");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    manifest.bundleVersion = "1.0";
    await writeJson(manifestPath, manifest);

    await assert.rejects(
      runGenerationAdapter({
        tool: "codex",
        surfaceId: "demo-surface",
        mode: "descriptor",
        bundleRoot,
        descriptor: buildDescriptor(),
      }),
      (error) =>
        error instanceof AdapterInputError &&
        error.code === "adapter.bundle.version-unsupported",
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter: rejects missing surface bundle entry", async () => {
  const { runGenerationAdapter, AdapterInputError } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-missing-surface-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    await assert.rejects(
      runGenerationAdapter({
        tool: "codex",
        surfaceId: "missing-surface",
        mode: "descriptor",
        bundleRoot,
        descriptor: buildDescriptor({ surfaceId: "missing-surface" }),
      }),
      (error) =>
        error instanceof AdapterInputError &&
        /Surface bundle directory not found/.test(error.message),
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter: rejects missing sibling ref files", async () => {
  const { runGenerationAdapter, AdapterInputError } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-missing-ref-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);
    await fsp.unlink(
      path.join(bundleRoot, "surfaces", "demo-surface", "sections.json"),
    );

    await assert.rejects(
      runGenerationAdapter({
        tool: "codex",
        surfaceId: "demo-surface",
        mode: "descriptor",
        bundleRoot,
        descriptor: buildDescriptor(),
      }),
      (error) =>
        error instanceof AdapterInputError &&
        /sections bundle file not found/i.test(error.message),
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter: rejects legacy contractPath request field", async () => {
  const { runGenerationAdapter, AdapterInputError } = await importDist(corePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-legacy-contract-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(contractPath, buildContract());
    await compileBundle(contractPath, bundleRoot, tempDir);

    await assert.rejects(
      runGenerationAdapter({
        tool: "codex",
        surfaceId: "demo-surface",
        mode: "descriptor",
        bundleRoot,
        contractPath,
        descriptor: buildDescriptor(),
      }),
      (error) =>
        error instanceof AdapterInputError &&
        error.code === "adapter.input.legacy-contract-path",
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter CLI maps block findings to exit code 30", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-cli-block-"));
  const contractPath = path.join(tempDir, "contract.json");
  const descriptorPath = path.join(tempDir, "descriptor.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(
      contractPath,
      buildContract({
        contract: {
          shell: {
            owns: ["navigation"],
          },
        },
      }),
    );
    await writeJson(
      descriptorPath,
      buildDescriptor({
        primitives: [
          {
            role: "navigation",
            count: 1,
            sources: ["generated.tsx"],
          },
        ],
      }),
    );
    await compileBundle(contractPath, bundleRoot, tempDir);

    const result = await runCli(
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

    assert.equal(result.exitCode, 30);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "block");
    assert.equal(payload.bundle.version, "2.0");
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("generation adapter server returns HTTP 422 for block findings", async () => {
  const { createGenerationAdapterServer } = await importDist(serverCommandPath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-server-block-"));
  const contractPath = path.join(tempDir, "contract.json");
  const bundleRoot = path.join(tempDir, "bundle");

  try {
    await writeJson(
      contractPath,
      buildContract({
        contract: {
          shell: {
            owns: ["navigation"],
          },
        },
      }),
    );
    await compileBundle(contractPath, bundleRoot, tempDir);

    const server = createGenerationAdapterServer({
      host: "127.0.0.1",
      bundleRoot,
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/surfaces.validateGeneration`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "req-1",
          tool: "codex",
          surfaceId: "demo-surface",
          mode: "descriptor",
          descriptor: buildDescriptor({
            primitives: [
              {
                role: "navigation",
                count: 1,
                sources: ["generated.tsx"],
              },
            ],
          }),
        }),
      },
    );

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.status, "block");
    assert.equal(payload.contract.id, "adapter-demo");

    await new Promise((resolve) => server.close(resolve));
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});
