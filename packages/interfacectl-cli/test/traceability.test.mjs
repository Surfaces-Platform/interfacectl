import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDiffOutput, validateFixSummary } from "@surfaces/interfacectl-validator";
import { enrichDiffEntry } from "../dist/utils/traceability.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../dist/index.js");
const traceabilityFixture = path.resolve(__dirname, "fixtures/traceability");

function runCLI(args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    proc.on("error", reject);
  });
}

test("surface-missing entry includes contractRef.surfaceId but omits contractRef.path", () => {
  const entry = {
    surfaceId: "unknown-surface",
    type: "added",
    path: "surfaces/unknown-surface",
    observedValue: {},
    severity: "error",
    rule: "contract.surface-missing",
  };

  const result = enrichDiffEntry(entry);

  assert.ok(result.contractRef);
  assert.equal(result.contractRef.surfaceId, "unknown-surface");
  assert.ok(!("path" in result.contractRef) || result.contractRef.path === undefined);
});

test("diff --format json emits stableId for every entry", async () => {
  const result = await runCLI(
    ["diff", "--contract", "contracts/ui.contract.json", "--format", "json"],
    traceabilityFixture,
  );
  const output = JSON.parse(result.stdout);
  const validation = validateDiffOutput(output);
  assert.equal(
    validation.ok,
    true,
    `Diff output should pass schema validation: ${validation.errors?.join("; ") ?? "unknown"}`,
  );
  assert(output.entries.length > 0, "Fixture should produce at least one diff entry");
  for (const entry of output.entries) {
    assert(entry.stableId, `Entry ${entry.path} should have stableId`);
    assert.equal(typeof entry.stableId, "string");
    assert(entry.stableId.length >= 1);
  }
});

test("diff entries include contractRef.path when contract node is unambiguous", async () => {
  const result = await runCLI(
    ["diff", "--contract", "contracts/ui.contract.json", "--format", "json"],
    traceabilityFixture,
  );
  const output = JSON.parse(result.stdout);
  for (const entry of output.entries) {
    assert(entry.contractRef, `Entry ${entry.path} should have contractRef`);
    assert(entry.contractRef.path, `Entry ${entry.path} should have contractRef.path`);
    assert(entry.contractRef.path.startsWith("/"), "contractRef.path should be JSON pointer style");
  }
});

test("diff entries include ruleRef.id when rule is present", async () => {
  const result = await runCLI(
    ["diff", "--contract", "contracts/ui.contract.json", "--format", "json"],
    traceabilityFixture,
  );
  const output = JSON.parse(result.stdout);
  for (const entry of output.entries) {
    assert(entry.ruleRef, `Entry ${entry.path} should have ruleRef`);
    assert(entry.ruleRef.id, `Entry ${entry.path} should have ruleRef.id`);
  }
});

test("stableId is deterministic across runs", async () => {
  const run1 = await runCLI(
    ["diff", "--contract", "contracts/ui.contract.json", "--format", "json"],
    traceabilityFixture,
  );
  const run2 = await runCLI(
    ["diff", "--contract", "contracts/ui.contract.json", "--format", "json"],
    traceabilityFixture,
  );
  const out1 = JSON.parse(run1.stdout);
  const out2 = JSON.parse(run2.stdout);
  assert.equal(out1.entries.length, out2.entries.length);
  const stableIds1 = new Map(out1.entries.map((e) => [e.path + "\0" + JSON.stringify(e.observedValue ?? e.contractValue), e.stableId]));
  const stableIds2 = new Map(out2.entries.map((e) => [e.path + "\0" + JSON.stringify(e.observedValue ?? e.contractValue), e.stableId]));
  for (const [key, id1] of stableIds1) {
    const id2 = stableIds2.get(key);
    assert(id2, `Second run should have entry for ${key}`);
    assert.equal(id1, id2, `stableId should be identical for same logical entry: ${id1} vs ${id2}`);
  }
});

test("enforce --format json emits stableId for applied and skipped actions", async () => {
  const result = await runCLI(
    [
      "enforce",
      "--mode",
      "fix",
      "--contract",
      "contracts/ui.contract.json",
      "--policy",
      "policy.json",
      "--format",
      "json",
      "--dry-run",
    ],
    traceabilityFixture,
  );
  const output = JSON.parse(result.stdout);
  const validation = validateFixSummary(output);
  assert.equal(validation.ok, true, "Fix summary should pass schema validation");
  assert(output.applied.length > 0, "Traceability policy should produce at least one applied fix");
  for (const fix of output.applied) {
    assert(fix.stableId, `Applied fix ${fix.path} should have stableId`);
  }
  for (const fix of output.skipped) {
    assert(fix.stableId, `Skipped fix ${fix.path} should have stableId`);
  }
});

test("enforce output includes contractRef and ruleRef when deterministically derivable", async () => {
  const result = await runCLI(
    [
      "enforce",
      "--mode",
      "fix",
      "--contract",
      "contracts/ui.contract.json",
      "--policy",
      "policy.json",
      "--format",
      "json",
      "--dry-run",
    ],
    traceabilityFixture,
  );
  const output = JSON.parse(result.stdout);
  const allItems = [...output.applied, ...output.skipped];
  for (const item of allItems) {
    assert(item.ruleRef, `Item ${item.path} should have ruleRef`);
    assert(item.ruleRef.id, `Item ${item.path} should have ruleRef.id`);
    if (item.contractRef && Object.keys(item.contractRef).length > 0) {
      assert(item.contractRef.path || item.contractRef.surfaceId, "contractRef should have path or surfaceId when present");
    }
  }
});
