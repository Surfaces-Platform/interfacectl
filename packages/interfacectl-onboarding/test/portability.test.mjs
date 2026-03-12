import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packagesRoot = path.resolve(__dirname, "..", "..");
const onboardingPackageDir = path.resolve(__dirname, "..");
const extractorPackageDir = path.join(packagesRoot, "interfacectl-extractor");
const validatorPackageDir = path.join(packagesRoot, "interfacectl-validator");

test("interfacectl-onboarding runs from tarball install", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "interfacectl-onboarding-portable-"));

  try {
    const packDir = path.join(tempRoot, "packs");
    await mkdir(packDir, { recursive: true });

    const validatorTarball = await packPackage(validatorPackageDir, packDir);
    const extractorTarball = await packPackage(extractorPackageDir, packDir);
    const onboardingTarball = await packPackage(onboardingPackageDir, packDir);

    const projectDir = path.join(tempRoot, "project");
    await mkdir(path.join(projectDir, "contracts", "generated"), { recursive: true });
    await mkdir(path.join(projectDir, "demo", "app"), { recursive: true });
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "interfacectl-onboarding-portable-fixture", private: true, version: "0.0.0" }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(projectDir, "contracts", "surfaces.web.contract.json"),
      JSON.stringify({
        contractId: "surfaces.web",
        version: "0.1.0",
        surfaces: [],
        sections: [],
        constraints: {
          motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(projectDir, "demo", "app", "page.tsx"),
      [
        "export default function Page() {",
        "  return (",
        "    <main>",
        "      <section>",
        "        <h1>Portable onboarding</h1>",
        "        <p>Tarball install smoke.</p>",
        "      </section>",
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const installResult = await runCommand(
      "npm",
      ["install", "--no-save", validatorTarball, extractorTarball, onboardingTarball],
      { cwd: projectDir },
    );
    assert.equal(installResult.exitCode, 0, `npm install failed: ${installResult.stderr}`);

    const script = [
      "import { runOnboardingRequest } from '@surfaces/interfacectl-onboarding';",
      "const result = await runOnboardingRequest({",
      "  rootDir: process.cwd(),",
      "  sourceMode: 'local-root',",
      "  appRoot: 'demo',",
      "});",
      "console.log(JSON.stringify({",
      "  state: result.state,",
      "  surfaceId: result.surfaceId,",
      "  contractPath: result.state === 'completed' ? result.artifacts.contractPath : null,",
      "}));",
      "",
    ].join("\n");

    const executionResult = await runCommand(
      "node",
      ["--input-type=module", "--eval", script],
      { cwd: projectDir },
    );
    assert.equal(executionResult.exitCode, 0, `portable run failed: ${executionResult.stderr}`);

    const payload = JSON.parse(executionResult.stdout);
    assert.equal(payload.state, "completed");
    assert.equal(payload.surfaceId, "demo");

    const generatedContract = JSON.parse(await readFile(payload.contractPath, "utf8"));
    assert.equal(generatedContract.surfaces[0].id, "demo");
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
  assert.equal(result.exitCode, 0, `npm pack failed in ${packageDir}: ${result.stderr}`);
  const tarballOutput = result.stdout.trim().split("\n").pop() ?? "";
  return path.isAbsolute(tarballOutput) ? tarballOutput : path.resolve(destinationDir, tarballOutput);
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
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
    exitCode: exitCode === null ? 1 : Number(exitCode),
  };
}
