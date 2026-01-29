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
  cp as copy,
  realpath,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packagesRoot = path.resolve(__dirname, "..", "..");
const cliPackageDir = path.resolve(__dirname, "..");
const validatorPackageDir = path.resolve(
  packagesRoot,
  "interfacectl-validator",
);
const fixtureRoot = path.resolve(
  __dirname,
  "fixtures",
  "minimal-project",
);

test("interfacectl validate runs from tarball install", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "interfacectl-portable-"),
  );

  try {
    const packDir = path.join(tempRoot, "packs");
    await mkdir(packDir, { recursive: true });

    const validatorTarball = await packPackage(
      validatorPackageDir,
      packDir,
    );
    const cliTarball = await packPackage(cliPackageDir, packDir);

    const projectDir = path.join(tempRoot, "project");
    await copy(fixtureRoot, projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "interfacectl-portable-fixture",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const installResult = await runCommand(
      "npm",
      ["install", "--no-save", validatorTarball, cliTarball],
      { cwd: projectDir },
    );

    assert.equal(
      installResult.exitCode,
      0,
      `npm install failed: ${installResult.stderr}`,
    );

    const cliExecutable = path.resolve(
      projectDir,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "interfacectl.cmd" : "interfacectl",
    );

    const validateResult = await runCommand(
      cliExecutable,
      [
        "validate",
        "--root",
        ".",
        "--contract",
        "./contracts/ui.contract.json",
        "--format",
        "json",
      ],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          SURFACES_ROOT: "",
          SURFACES_CONTRACT: "",
        },
      },
    );

    assert.equal(
      validateResult.exitCode,
      0,
      `interfacectl validate failed: ${validateResult.stderr}\n${validateResult.stdout}`,
    );

    const payload = JSON.parse(validateResult.stdout);

    assert.equal(payload.summary.errors, 0, "No contract errors expected");
    assert.equal(
      payload.summary.warnings,
      0,
      "No contract warnings expected",
    );
    assert.ok(
      Array.isArray(payload.findings) && payload.findings.length === 0,
      "Fixture validation should produce no findings",
    );
    const resolvedPayloadPath = await realpath(payload.contractPath);
    const expectedContractPath = await realpath(
      path.resolve(projectDir, "contracts", "ui.contract.json"),
    );
    assert.equal(
      resolvedPayloadPath,
      expectedContractPath,
      "Contract path should match fully resolved contract location",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function packPackage(packageDir, destinationDir) {
  const result = await runCommand(
    "npm",
    ["pack", "--pack-destination", destinationDir],
    { cwd: packageDir },
  );

  assert.equal(
    result.exitCode,
    0,
    `npm pack failed in ${packageDir}: ${result.stderr}`,
  );

  const tarballOutput = result.stdout.trim().split("\n").pop() ?? "";
  const tarballPath = path.isAbsolute(tarballOutput)
    ? tarballOutput
    : path.resolve(destinationDir, tarballOutput);

  return tarballPath;
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  let stdout = "";
  let stderr = "";

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
  }

  const [exitCode] = await once(child, "exit");

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: Number(exitCode),
  };
}

