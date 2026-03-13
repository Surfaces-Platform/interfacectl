import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { validateDiffOutput } from "@surfaces/interfacectl-validator";
import contractRunsSchema from "../schemas/contract-runs.schema.json" with { type: "json" };
import contractLineageSchema from "../schemas/contract-lineage.schema.json" with { type: "json" };

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

function validateWithSchema(payload, schema, label) {
  const result = validateDiffOutput(payload, schema);
  assert.equal(result.ok, true, `${label} should satisfy schema: ${JSON.stringify(result.errors)}`);
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("emit-run-artifact writes canonical v2 runs, lineage, and dedupes idempotency keys", async () => {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-run-artifacts-"));
  const contractPath = path.join(workspaceRoot, "contracts", "surfaces.web.contract.json");
  const reportPath = path.join(workspaceRoot, "artifacts", "report.json");

  try {
    await writeJson(contractPath, {
      contractId: "surfaces.web",
      version: "1.0.0",
      surfaces: [{ id: "demo-surface", displayName: "Demo Surface", type: "web" }],
    });
    await writeJson(reportPath, { findings: [] });

    const first = await runCli(
      [
        "emit-run-artifact",
        "--workspace-root",
        workspaceRoot,
        "--surface",
        "demo-surface",
        "--source",
        "ci",
        "--status",
        "warn",
        "--report-path",
        reportPath,
        "--finding-codes",
        "icon.source-disallowed",
        "--workspace-id",
        "ws-test",
        "--idempotency-key",
        "demo:1",
      ],
      workspaceRoot,
    );
    assert.equal(first.exitCode, 0, first.stderr);

    const second = await runCli(
      [
        "emit-run-artifact",
        "--workspace-root",
        workspaceRoot,
        "--surface",
        "demo-surface",
        "--source",
        "ci",
        "--status",
        "warn",
        "--report-path",
        reportPath,
        "--finding-codes",
        "icon.source-disallowed",
        "--workspace-id",
        "ws-test",
        "--idempotency-key",
        "demo:1",
      ],
      workspaceRoot,
    );
    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stdout, /"deduped": true/);

    const runs = JSON.parse(
      await fsp.readFile(path.join(workspaceRoot, "contracts", "generated", "contract-runs.json"), "utf8"),
    );
    const lineage = JSON.parse(
      await fsp.readFile(path.join(workspaceRoot, "contracts", "generated", "contract-lineage.json"), "utf8"),
    );

    validateWithSchema(runs, contractRunsSchema, "contract runs");
    validateWithSchema(lineage, contractLineageSchema, "contract lineage");
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].workspaceId, "ws-test");
    assert.equal(runs.runs[0].idempotencyKey, "demo:1");
    assert.equal(lineage.surfaces["demo-surface"].lastRunId, runs.runs[0].runId);
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  }
});
