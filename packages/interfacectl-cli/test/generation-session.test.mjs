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
import generationAssessmentSchema from "../schemas/generation-assessment.schema.json" with { type: "json" };
import generationSessionSchema from "../schemas/generation-session.schema.json" with { type: "json" };
import generationSessionSummarySchema from "../schemas/generation-session-summary.schema.json" with { type: "json" };
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

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, value, "utf8");
}

function validateWithSchema(payload, schema, label) {
  const result = validateDiffOutput(payload, schema);
  assert.equal(result.ok, true, `${label} should satisfy schema: ${JSON.stringify(result.errors)}`);
}

function buildContract() {
  return {
    contractId: "generation-session-demo",
    version: "1.0.0",
    surfaces: [
      {
        id: "demo-surface",
        displayName: "Demo Surface",
        type: "web",
        requiredSections: ["main.hero"],
        allowedFonts: ["sans-serif"],
        layout: {
          maxContentWidth: 960,
          requiredContainers: ["page-container"],
        },
      },
    ],
    sections: [
      {
        id: "main.hero",
        intent: "hero",
        description: "Demo hero section.",
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
  };
}

async function writeDemoWorkspace(workspaceRoot, { valid }) {
  await writeJson(
    path.join(workspaceRoot, "contracts", "surfaces.web.contract.json"),
    buildContract(),
  );
  await writeJson(
    path.join(workspaceRoot, "contracts", "generated", "demo-surface.contract.json"),
    buildContract(),
  );

  await writeText(
    path.join(workspaceRoot, "apps", "demo-surface", "app", "globals.css"),
    `:root {
  --contract-max-width: 960px;
  --contract-motion-duration: 120ms;
  --contract-motion-timing: linear;
}

body {
  font-family: sans-serif;
  color: #111111;
  background: #ffffff;
}

[data-contract="page-container"] {
  max-width: 960px;
}

[data-contract-section="main.hero"] {
  transition: opacity 120ms linear;
}
`,
  );

  const sectionAttribute = valid ? ' data-contract-section="main.hero"' : "";
  const containerAttribute = valid ? ' data-contract-container="page-container"' : "";
  await writeText(
    path.join(workspaceRoot, "apps", "demo-surface", "app", "page.tsx"),
    `export default function Page() {
  return (
    <main data-contract="page-container"${containerAttribute}>
      <section${sectionAttribute}>
        <h1>Demo Surface</h1>
      </section>
    </main>
  );
}
`,
  );
}

test("generation session commands freeze bundle input, record attempts, and emit canonical run artifacts", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-session-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "demo-session");

  try {
    await writeDemoWorkspace(workspaceRoot, { valid: false });

    const compileResult = await runCli(
      [
        "compile",
        "--contract",
        path.join(workspaceRoot, "contracts", "surfaces.web.contract.json"),
        "--out",
        bundleRoot,
      ],
      tempRoot,
    );
    assert.equal(compileResult.exitCode, 0, compileResult.stderr);

    const initResult = await runCli(
      [
        "init-generation-session",
        "--bundle-root",
        bundleRoot,
        "--surface",
        "demo-surface",
        "--workspace-root",
        workspaceRoot,
        "--tool",
        "codex",
        "--session",
        "demo-session",
      ],
      tempRoot,
    );
    assert.equal(initResult.exitCode, 0, initResult.stderr);

    const session = JSON.parse(await fsp.readFile(path.join(sessionDir, "session.json"), "utf8"));
    validateWithSchema(session, generationSessionSchema, "generation session");
    assert.ok(fs.existsSync(path.join(sessionDir, "bundle", "manifest.json")));
    assert.ok(fs.existsSync(path.join(sessionDir, "prepared-input.json")));

    const assessmentOnePath = path.join(tempRoot, "assessment-1.json");
    await writeJson(assessmentOnePath, {
      structure: "weak",
      visual: "partial",
      responsiveness: "weak",
      notes: "Initial draft misses the contract markers.",
      touchedFiles: ["apps/demo-surface/app/page.tsx"],
    });

    const attemptOneResult = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        assessmentOnePath,
      ],
      tempRoot,
    );
    assert.equal(attemptOneResult.exitCode, 0, attemptOneResult.stderr);

    const attemptOneValidate = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "attempts", "001.validate.json"), "utf8"),
    );
    const attemptOneAssessment = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "attempts", "001.assessment.json"), "utf8"),
    );
    validateWithSchema(attemptOneAssessment, generationAssessmentSchema, "generation assessment");
    assert.equal(attemptOneValidate.status, "block");

    const summaryWarn = await runCli(
      ["summarize-generation-session", "--session-dir", sessionDir],
      tempRoot,
    );
    assert.equal(summaryWarn.exitCode, 30, summaryWarn.stderr);

    const runsAfterFirstAttempt = JSON.parse(
      await fsp.readFile(path.join(workspaceRoot, "contracts", "generated", "contract-runs.json"), "utf8"),
    );
    validateWithSchema(runsAfterFirstAttempt, contractRunsSchema, "contract runs");
    assert.equal(runsAfterFirstAttempt.runs.length, 1);
    assert.equal(runsAfterFirstAttempt.runs[0].source, "generation");
    assert.equal(runsAfterFirstAttempt.runs[0].workspaceId, "demo-session");
    assert.match(runsAfterFirstAttempt.runs[0].ingestedAt, /T/);

    await writeDemoWorkspace(workspaceRoot, { valid: true });
    const assessmentTwoPath = path.join(tempRoot, "assessment-2.json");
    await writeJson(assessmentTwoPath, {
      structure: "strong",
      visual: "strong",
      responsiveness: "strong",
      notes: "Added the missing section and container markers.",
      touchedFiles: ["apps/demo-surface/app/page.tsx", "apps/demo-surface/app/globals.css"],
    });

    const attemptTwoResult = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        assessmentTwoPath,
      ],
      tempRoot,
    );
    assert.equal(attemptTwoResult.exitCode, 0, attemptTwoResult.stderr);

    const summaryPass = await runCli(
      ["summarize-generation-session", "--session-dir", sessionDir],
      tempRoot,
    );
    assert.equal(summaryPass.exitCode, 0, summaryPass.stderr);

    const summary = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "summary.json"), "utf8"),
    );
    validateWithSchema(summary, generationSessionSummarySchema, "generation session summary");
    assert.equal(summary.attemptCount, 2);
    assert.equal(summary.firstPassAttempt, 2);
    assert.equal(summary.latestStatus, "pass");
    assert.equal(summary.latestAssessment.notes, "Added the missing section and container markers.");
    assert.deepEqual(summary.recurringFindingCodes, []);
    assert.deepEqual(summary.recurringRepairCodes, []);

    const lineage = JSON.parse(
      await fsp.readFile(path.join(workspaceRoot, "contracts", "generated", "contract-lineage.json"), "utf8"),
    );
    validateWithSchema(lineage, contractLineageSchema, "contract lineage");
    assert.equal(lineage.surfaces["demo-surface"].lastStatus, "pass");
    assert.equal(lineage.surfaces["demo-surface"].lastSource, "generation");
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("generation session commands reject invalid bundle roots, duplicate sessions, invalid assessments, and missing sessions", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-session-errors-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "demo-session");

  try {
    await writeDemoWorkspace(workspaceRoot, { valid: true });
    const compileResult = await runCli(
      [
        "compile",
        "--contract",
        path.join(workspaceRoot, "contracts", "surfaces.web.contract.json"),
        "--out",
        bundleRoot,
      ],
      tempRoot,
    );
    assert.equal(compileResult.exitCode, 0, compileResult.stderr);

    const missingBundle = await runCli(
      [
        "init-generation-session",
        "--bundle-root",
        path.join(tempRoot, "missing-bundle"),
        "--surface",
        "demo-surface",
        "--workspace-root",
        workspaceRoot,
      ],
      tempRoot,
    );
    assert.equal(missingBundle.exitCode, 10);
    assert.match(missingBundle.stderr, /Bundle root directory not found/);

    const missingWorkspace = await runCli(
      [
        "init-generation-session",
        "--bundle-root",
        bundleRoot,
        "--surface",
        "demo-surface",
        "--workspace-root",
        path.join(tempRoot, "missing-workspace"),
      ],
      tempRoot,
    );
    assert.equal(missingWorkspace.exitCode, 10);
    assert.match(missingWorkspace.stderr, /Workspace root directory not found/);

    const firstInit = await runCli(
      [
        "init-generation-session",
        "--bundle-root",
        bundleRoot,
        "--surface",
        "demo-surface",
        "--workspace-root",
        workspaceRoot,
        "--session",
        "demo-session",
      ],
      tempRoot,
    );
    assert.equal(firstInit.exitCode, 0, firstInit.stderr);

    const duplicateInit = await runCli(
      [
        "init-generation-session",
        "--bundle-root",
        bundleRoot,
        "--surface",
        "demo-surface",
        "--workspace-root",
        workspaceRoot,
        "--session",
        "demo-session",
      ],
      tempRoot,
    );
    assert.equal(duplicateInit.exitCode, 10);
    assert.match(duplicateInit.stderr, /already exists/);

    const invalidAssessmentPath = path.join(tempRoot, "assessment-invalid.json");
    await writeJson(invalidAssessmentPath, {
      structure: "bad",
      visual: "partial",
      responsiveness: "weak",
      notes: "Invalid assessment payload.",
    });

    const invalidAssessment = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        invalidAssessmentPath,
      ],
      tempRoot,
    );
    assert.equal(invalidAssessment.exitCode, 10);
    assert.match(invalidAssessment.stderr, /strong\|partial\|weak/);

    const missingSession = await runCli(
      [
        "summarize-generation-session",
        "--session-dir",
        path.join(tempRoot, "missing-session"),
      ],
      tempRoot,
    );
    assert.equal(missingSession.exitCode, 10);
    assert.match(missingSession.stderr, /Generation session not found/);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("generation session summary aggregates recurring finding and repair codes", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-session-summary-"));
  const sessionDir = path.join(tempRoot, "artifacts", "generation-sessions", "demo-surface", "summary-session");
  const bundleSurfaceDir = path.join(sessionDir, "bundle", "surfaces", "demo-surface");

  try {
    await writeJson(path.join(sessionDir, "session.json"), {
      schemaVersion: 1,
      surfaceId: "demo-surface",
      sessionId: "summary-session",
      tool: "codex",
      workspaceRoot: tempRoot,
      sourceBundleRoot: path.join(tempRoot, "source-bundle"),
      sessionDir,
      bundleRoot: path.join(sessionDir, "bundle"),
      preparedInputPath: path.join(sessionDir, "prepared-input.json"),
      contractPath: path.join(sessionDir, "bundle", "contract", "normalized.json"),
      repairMapPath: path.join(bundleSurfaceDir, "repair-map.json"),
      startedAt: "2026-03-12T00:00:00.000Z",
      successRule: { finalStatus: "pass" },
    });
    await writeJson(path.join(bundleSurfaceDir, "repair-map.json"), {
      repairs: [
        {
          code: "section.required.missing",
          priority: "high",
          category: "structure",
          action: {
            type: "add-section",
          },
        },
      ],
    });
    await writeJson(path.join(sessionDir, "attempts", "001.validate.json"), {
      status: "warn",
      findings: [{ code: "section.required.missing" }],
    });
    await writeJson(path.join(sessionDir, "attempts", "001.assessment.json"), {
      structure: "partial",
      visual: "partial",
      responsiveness: "partial",
      notes: "Still missing the hero section.",
    });
    await writeJson(path.join(sessionDir, "attempts", "001.metadata.json"), {
      createdAt: "2026-03-12T00:00:00.000Z",
    });
    await writeJson(path.join(sessionDir, "attempts", "002.validate.json"), {
      status: "warn",
      findings: [{ code: "section.required.missing" }],
    });
    await writeJson(path.join(sessionDir, "attempts", "002.assessment.json"), {
      structure: "partial",
      visual: "strong",
      responsiveness: "strong",
      notes: "Section is still pending.",
    });
    await writeJson(path.join(sessionDir, "attempts", "002.metadata.json"), {
      createdAt: "2026-03-12T00:01:00.000Z",
    });

    const result = await runCli(
      ["summarize-generation-session", "--session-dir", sessionDir],
      tempRoot,
    );
    assert.equal(result.exitCode, 30, result.stderr);

    const summary = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "summary.json"), "utf8"),
    );
    validateWithSchema(summary, generationSessionSummarySchema, "generation session summary");
    assert.deepEqual(summary.recurringFindingCodes, [{ code: "section.required.missing", count: 2 }]);
    assert.deepEqual(summary.recurringRepairCodes, [
      {
        code: "section.required.missing",
        count: 2,
        priority: "high",
        category: "structure",
        actionType: "add-section",
      },
    ]);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});
