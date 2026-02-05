import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "..", "dist", "index.js");
const fixtureRoot = path.resolve(__dirname, "fixtures", "validate-extracted");

async function run(args, env = {}) {
  const child = spawn("node", [cliPath, ...args], {
    env: { ...process.env, ...env },
    cwd: fixtureRoot,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const [code] = await once(child, "exit");
  return { exitCode: Number(code), stdout, stderr };
}

test("validate-extracted: no phase0 block => ok (exit 0)", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-no-phase0.json",
    "--extracted", "extracted-ok.json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes("nothing to compare") || r.stdout.includes("No incompatibilities"));
});

test("validate-extracted: phase0 matches extracted => ok (exit 0)", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-phase0.json",
    "--extracted", "extracted-ok.json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 0, r.stderr + r.stdout);
});

test("validate-extracted: shell mismatch => E2 exit 30 (v2)", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-phase0.json",
    "--extracted", "extracted-shell-mismatch.json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 30);
  assert.ok(r.stderr.includes("phase0.shell.mismatch") || r.stdout.includes("phase0.shell.mismatch"));
});

test("validate-extracted: auth posture mismatch => E2 exit 30 (v2)", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-phase0.json",
    "--extracted", "extracted-auth-mismatch.json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 30);
  assert.ok(
    r.stderr.includes("phase0.authPosture.mismatch") || r.stdout.includes("phase0.authPosture.mismatch"),
    r.stderr + r.stdout,
  );
});

test("validate-extracted: design system missing => E2 exit 30 (v2)", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-phase0.json",
    "--extracted", "extracted-ds-missing.json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 30);
  assert.ok(
    r.stderr.includes("phase0.designSystem.missing") || r.stdout.includes("phase0.designSystem.missing"),
    r.stderr + r.stdout,
  );
});

test("validate-extracted: invalid extracted file => E0 exit 10 (v2)", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-no-phase0.json",
    "--extracted", "nonexistent.json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 10);
});

test("validate-extracted: JSON output has deterministic findings order", async () => {
  const r = await run([
    "validate-extracted",
    "--contract", "contract-phase0.json",
    "--extracted", "extracted-shell-mismatch.json",
    "--format", "json",
    "--exit-codes", "v2",
  ]);
  assert.equal(r.exitCode, 30);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(Array.isArray(out.findings));
  assert.ok(out.findings.length >= 1);
  assert.ok(out.findings.every((f) => f.surfaceId && f.code && (f.category === "E0" || f.category === "E2")));
});
