import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const forceFileStorageEnv = { INTERFACECTL_AUTH_DISABLE_KEYCHAIN: "1" };

async function run(args, options = {}) {
  const child = spawn("node", [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const [exitCode] = await once(child, "exit");
  return { exitCode: Number(exitCode), stdout, stderr };
}

test("init: non-interactive remote-url writes onboarding artifacts and run metadata", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-init-remote-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  try {
    await mkdir(path.join(cwd, "contracts"), { recursive: true });
    await writeFile(
      path.join(cwd, "contracts", "surfaces.web.contract.json"),
      JSON.stringify({
        contractId: "test-contract",
        version: "1.0.0",
        surfaces: [],
        sections: [],
        constraints: {
          motion: { allowedDurationsMs: [120], allowedTimingFunctions: ["linear"] },
        },
      }, null, 2),
      "utf-8",
    );

    const result = await run(
      [
        "init",
        "--non-interactive",
        "--url",
        "https://customer.example.com/products",
        "--surface",
        "customer-products",
      ],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const generatedDir = path.join(cwd, "contracts", "generated");
    const contract = JSON.parse(
      await readFile(path.join(generatedDir, "customer-products.contract.json"), "utf-8"),
    );
    const extraction = JSON.parse(
      await readFile(path.join(generatedDir, "customer-products.extraction.json"), "utf-8"),
    );
    const runs = JSON.parse(
      await readFile(path.join(generatedDir, "contract-runs.json"), "utf-8"),
    );
    const lineage = JSON.parse(
      await readFile(path.join(generatedDir, "contract-lineage.json"), "utf-8"),
    );

    assert.equal(contract.surfaces[0].id, "customer-products");
    assert.equal(extraction.onboarding.extractMode, "remote-url");
    assert.equal(extraction.onboarding.authMode, "none");
    assert.equal(runs.schemaVersion, 1);
    assert.equal(runs.runs[0].source, "bootstrap");
    assert.equal(lineage.surfaces["customer-products"].lastSource, "bootstrap");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("auth: list/test/clear operate on local profile store", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  try {
    await writeFile(
      profilePath,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            name: "demo",
            domain: "customer.example.com",
            mode: "browser-session",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            sessionRef: "session-1",
          },
        ],
      }, null, 2),
      "utf-8",
    );

    const list = await run(
      ["auth", "list", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(list.exitCode, 0, list.stderr);
    const listPayload = JSON.parse(list.stdout);
    assert.equal(listPayload.ok, true);
    assert.equal(listPayload.profiles.length, 1);
    assert.equal(listPayload.profiles[0].name, "demo");

    const testProfile = await run(
      ["auth", "test", "--profile", "demo", "--domain", "customer.example.com", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(testProfile.exitCode, 0, testProfile.stderr);
    assert.equal(JSON.parse(testProfile.stdout).ok, true);

    const clear = await run(
      ["auth", "revoke", "--profile", "demo", "--domain", "customer.example.com", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(clear.exitCode, 0, clear.stderr);
    assert.equal(JSON.parse(clear.stdout).removed, 1);

    const listAfter = await run(
      ["auth", "list", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(listAfter.exitCode, 0, listAfter.stderr);
    assert.equal(JSON.parse(listAfter.stdout).profiles.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("auth test returns non-zero when profile is expired", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "interfacectl-auth-expired-"));
  const profilePath = path.join(cwd, "auth-profiles.json");
  try {
    await writeFile(
      profilePath,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            name: "expired",
            domain: "customer.example.com",
            mode: "browser-session",
            createdAt: new Date(Date.now() - 7200_000).toISOString(),
            updatedAt: new Date(Date.now() - 7200_000).toISOString(),
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
            sessionRef: "session-2",
          },
        ],
      }, null, 2),
      "utf-8",
    );
    const result = await run(
      ["auth", "test", "--profile", "expired", "--domain", "customer.example.com", "--format", "json"],
      { cwd, env: { ...forceFileStorageEnv, INTERFACECTL_AUTH_PROFILES_PATH: profilePath } },
    );
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /expired/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
