import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { validateDiffOutput } from "@surfaces/interfacectl-validator";
import generationAssessmentSchema from "../schemas/generation-assessment.schema.json" with { type: "json" };
import generationAttemptReviewSchema from "../schemas/generation-attempt-review.schema.json" with { type: "json" };
import generationAttemptPreviewSchema from "../schemas/generation-attempt-preview.schema.json" with { type: "json" };
import generationSessionSchema from "../schemas/generation-session.schema.json" with { type: "json" };
import generationSessionSummarySchema from "../schemas/generation-session-summary.schema.json" with { type: "json" };
import generationGuidanceHandoffSchema from "../schemas/generation-guidance-handoff.schema.json" with { type: "json" };
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

async function writeDemoWorkspace(workspaceRoot, { sectionValid, colorValid }) {
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
  color: ${colorValid ? "#111111" : "#ff00ff"};
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

  const sectionAttribute = sectionValid ? ' data-contract-section="main.hero"' : "";
  const containerAttribute = sectionValid ? ' data-contract-container="page-container"' : "";
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

function buildAssessment({
  structure,
  components,
  boundary,
  visual,
  responsiveness,
  notes,
  touchedFiles,
  heuristics,
}) {
  return {
    structure,
    components,
    boundary,
    visual,
    responsiveness,
    notes,
    ...(touchedFiles ? { touchedFiles } : {}),
    ...(heuristics ? { heuristics } : {}),
  };
}

let chromiumAvailability;

async function ensureChromiumAvailable(t) {
  if (chromiumAvailability === undefined) {
    chromiumAvailability = await new Promise((resolve) => {
      const child = spawn(
        "node",
        [
          "-e",
          "import('playwright').then(async ({ chromium }) => { const browser = await chromium.launch({ headless: true }); await browser.close(); }).then(() => process.exit(0)).catch(() => process.exit(1));",
        ],
        {
          cwd: path.resolve(__dirname, ".."),
          env: process.env,
        },
      );
      child.on("exit", (code) => resolve(code === 0));
    });
  }
  if (!chromiumAvailability) {
    t.skip("Playwright Chromium is not installed.");
  }
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("generation session commands freeze bundle input, record attempts, and emit canonical run artifacts", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-session-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "demo-session");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: false, colorValid: true });

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
        "local-llm",
        "--session",
        "demo-session",
      ],
      tempRoot,
    );
    assert.equal(initResult.exitCode, 0, initResult.stderr);

    const session = JSON.parse(await fsp.readFile(path.join(sessionDir, "session.json"), "utf8"));
    validateWithSchema(session, generationSessionSchema, "generation session");
    assert.equal(session.guidanceStrategy, "prompt-summary");
    assert.ok(fs.existsSync(path.join(sessionDir, "bundle", "manifest.json")));
    assert.ok(fs.existsSync(path.join(sessionDir, "prepared-input.json")));
    assert.ok(fs.existsSync(path.join(sessionDir, "guidance-handoff.json")));
    const handoff = JSON.parse(await fsp.readFile(path.join(sessionDir, "guidance-handoff.json"), "utf8"));
    validateWithSchema(handoff, generationGuidanceHandoffSchema, "generation guidance handoff");
    assert.equal(handoff.guidanceStrategy, "prompt-summary");
    assert.equal(Boolean(handoff.promptSummary), true);
    assert.equal(handoff.jsonPrimary, null);

    const assessmentOnePath = path.join(tempRoot, "assessment-1.json");
    await writeJson(
      assessmentOnePath,
      buildAssessment({
        structure: "weak",
        components: "weak",
        boundary: "weak",
        visual: "partial",
        responsiveness: "weak",
        notes: "Initial draft misses the contract markers.",
        touchedFiles: ["apps/demo-surface/app/page.tsx"],
      }),
    );

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

    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: true });
    const assessmentTwoPath = path.join(tempRoot, "assessment-2.json");
    await writeJson(
      assessmentTwoPath,
      buildAssessment({
        structure: "strong",
        components: "strong",
        boundary: "strong",
        visual: "strong",
        responsiveness: "strong",
        notes: "Added the missing section and container markers.",
        touchedFiles: ["apps/demo-surface/app/page.tsx", "apps/demo-surface/app/globals.css"],
      }),
    );

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
    assert.equal(summary.firstAcceptableAttempt, 2);
    assert.equal(summary.latestStatus, "pass");
    assert.equal(summary.latestOutcome, "pass");
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

test("prepare-generation-handoff emits deterministic strategy artifacts with runtime guidance", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-handoff-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "handoff-session");
  const acceptedSuggestionsPath = path.join(tempRoot, "accepted-suggestions.json");
  const designerNotesPath = path.join(tempRoot, "designer-notes.json");
  const promptSummaryPath = path.join(tempRoot, "prompt-summary-handoff.json");
  const jsonPrimaryOnePath = path.join(tempRoot, "json-primary-handoff-1.json");
  const jsonPrimaryTwoPath = path.join(tempRoot, "json-primary-handoff-2.json");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: false, colorValid: true });

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
        "--session",
        "handoff-session",
      ],
      tempRoot,
    );
    assert.equal(initResult.exitCode, 0, initResult.stderr);

    await writeJson(acceptedSuggestionsPath, {
      suggestions: [
        {
          findingCode: "section.required.missing",
          findingMessage: "Main hero section is missing.",
          summary: "Restore the main hero section.",
          suggestedPath: "surfaces[id=demo-surface].requiredSections",
          rationale: "The fixture requires the main hero section.",
        },
      ],
    });
    await writeJson(designerNotesPath, {
      designerNotes: [
        "Keep the hero heading flush left.",
        "Anchor links should use the contract accent.",
      ],
    });

    const promptSummaryResult = await runCli(
      [
        "prepare-generation-handoff",
        "--session-dir",
        sessionDir,
        "--guidance-strategy",
        "prompt-summary",
        "--accepted-suggestions",
        acceptedSuggestionsPath,
        "--designer-notes",
        designerNotesPath,
        "--finding-codes",
        "section.required.missing",
        "--out",
        promptSummaryPath,
      ],
      tempRoot,
    );
    assert.equal(promptSummaryResult.exitCode, 0, promptSummaryResult.stderr);

    const jsonPrimaryArgs = [
      "prepare-generation-handoff",
      "--session-dir",
      sessionDir,
      "--guidance-strategy",
      "json-primary",
      "--accepted-suggestions",
      acceptedSuggestionsPath,
      "--designer-notes",
      designerNotesPath,
      "--finding-codes",
      "section.required.missing",
    ];
    const jsonPrimaryOneResult = await runCli([...jsonPrimaryArgs, "--out", jsonPrimaryOnePath], tempRoot);
    const jsonPrimaryTwoResult = await runCli([...jsonPrimaryArgs, "--out", jsonPrimaryTwoPath], tempRoot);
    assert.equal(jsonPrimaryOneResult.exitCode, 0, jsonPrimaryOneResult.stderr);
    assert.equal(jsonPrimaryTwoResult.exitCode, 0, jsonPrimaryTwoResult.stderr);

    const promptSummary = JSON.parse(await fsp.readFile(promptSummaryPath, "utf8"));
    const jsonPrimaryOne = JSON.parse(await fsp.readFile(jsonPrimaryOnePath, "utf8"));
    const jsonPrimaryTwo = JSON.parse(await fsp.readFile(jsonPrimaryTwoPath, "utf8"));
    validateWithSchema(promptSummary, generationGuidanceHandoffSchema, "prompt-summary guidance handoff");
    validateWithSchema(jsonPrimaryOne, generationGuidanceHandoffSchema, "json-primary guidance handoff");
    validateWithSchema(jsonPrimaryTwo, generationGuidanceHandoffSchema, "repeated json-primary guidance handoff");
    assert.deepEqual(jsonPrimaryOne, jsonPrimaryTwo);
    assert.equal(promptSummary.guidanceStrategy, "prompt-summary");
    assert.equal(jsonPrimaryOne.guidanceStrategy, "json-primary");
    assert.equal(Boolean(promptSummary.promptSummary), true);
    assert.equal(promptSummary.jsonPrimary, null);
    assert.equal(promptSummary.runtimeGuidance.acceptedSuggestions.length, 1);
    assert.equal(promptSummary.runtimeGuidance.designerNotes.length, 2);
    assert.equal(promptSummary.runtimeGuidance.findingCodes.includes("section.required.missing"), true);
    assert.equal(jsonPrimaryOne.promptSummary, null);
    assert.equal(Boolean(jsonPrimaryOne.jsonPrimary), true);
    assert.equal(jsonPrimaryOne.jsonPrimary.sections.length > 0, true);
    assert.equal(Array.isArray(jsonPrimaryOne.runtimeGuidance.matchedRepairCodes), true);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("review-generation-attempt marks reviewed warnings acceptable without changing the validate payload", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-review-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "warn-session");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: false });

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
        "--session",
        "warn-session",
      ],
      tempRoot,
    );
    assert.equal(initResult.exitCode, 0, initResult.stderr);

    const assessmentPath = path.join(tempRoot, "warn-assessment.json");
    await writeJson(
      assessmentPath,
      buildAssessment({
        structure: "strong",
        components: "strong",
        boundary: "strong",
        visual: "partial",
        responsiveness: "strong",
        notes: "Everything matches except the text color.",
      }),
    );

    const recordResult = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        assessmentPath,
      ],
      tempRoot,
    );
    assert.equal(recordResult.exitCode, 0, recordResult.stderr);

    const validatePayload = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "attempts", "001.validate.json"), "utf8"),
    );
    assert.equal(validatePayload.status, "warn");
    const findingCodes = validatePayload.findings.map((entry) => entry.code).sort();

    const reviewFile = path.join(tempRoot, "warn-review.json");
    await writeJson(reviewFile, {
      status: "accepted",
      findingCodes,
      rationale: "The remaining color warning is acceptable for this benchmark attempt.",
    });

    const reviewResult = await runCli(
      [
        "review-generation-attempt",
        "--session-dir",
        sessionDir,
        "--attempt",
        "1",
        "--review-file",
        reviewFile,
      ],
      tempRoot,
    );
    assert.equal(reviewResult.exitCode, 0, reviewResult.stderr);

    const reviewPayload = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "attempts", "001.review.json"), "utf8"),
    );
    validateWithSchema(reviewPayload, generationAttemptReviewSchema, "generation attempt review");
    assert.equal(reviewPayload.status, "accepted");

    const summaryResult = await runCli(
      ["summarize-generation-session", "--session-dir", sessionDir],
      tempRoot,
    );
    assert.equal(summaryResult.exitCode, 0, summaryResult.stderr);

    const summary = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "summary.json"), "utf8"),
    );
    validateWithSchema(summary, generationSessionSummarySchema, "generation session summary");
    assert.equal(summary.latestStatus, "warn");
    assert.equal(summary.latestOutcome, "accepted-warn");
    assert.equal(summary.firstAcceptableAttempt, 1);
    assert.equal(summary.latestReview.status, "accepted");

    const validatePayloadAfterReview = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "attempts", "001.validate.json"), "utf8"),
    );
    assert.deepEqual(validatePayloadAfterReview, validatePayload);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("capture-generation-preview writes preview artifacts and surfaces explicit preview refs in the session summary", async (t) => {
  await ensureChromiumAvailable(t);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-preview-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "preview-session");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: true });

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
        "--session",
        "preview-session",
      ],
      tempRoot,
    );
    assert.equal(initResult.exitCode, 0, initResult.stderr);

    const assessmentPath = path.join(tempRoot, "preview-assessment.json");
    await writeJson(
      assessmentPath,
      buildAssessment({
        structure: "strong",
        components: "strong",
        boundary: "strong",
        visual: "strong",
        responsiveness: "strong",
        notes: "Preview-ready attempt.",
      }),
    );

    const recordResult = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        assessmentPath,
      ],
      tempRoot,
    );
    assert.equal(recordResult.exitCode, 0, recordResult.stderr);

    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head><title>Preview target</title></head>
  <body>
    <main>
      <h1>Demo Surface Preview</h1>
      <p>Benchmark ready</p>
    </main>
  </body>
</html>`);
    }, async (origin) => {
      const captureResult = await runCli(
        [
          "capture-generation-preview",
          "--session-dir",
          sessionDir,
          "--attempt",
          "1",
          "--url",
          `${origin}/preview`,
          "--wait-for",
          "Benchmark ready",
        ],
        tempRoot,
      );
      assert.equal(captureResult.exitCode, 0, captureResult.stderr);
    });

    const preview = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "attempts", "001.preview.json"), "utf8"),
    );
    validateWithSchema(preview, generationAttemptPreviewSchema, "generation attempt preview");
    assert.equal(fs.existsSync(path.join(sessionDir, "attempts", "001.preview.png")), true);
    assert.equal(preview.pageTitle, "Preview target");
    assert.equal(preview.waitFor, "Benchmark ready");

    const summaryResult = await runCli(
      ["summarize-generation-session", "--session-dir", sessionDir],
      tempRoot,
    );
    assert.equal(summaryResult.exitCode, 0, summaryResult.stderr);

    const summary = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "summary.json"), "utf8"),
    );
    validateWithSchema(summary, generationSessionSummarySchema, "generation session summary");
    assert.equal(summary.schemaVersion, 4);
    assert.equal(summary.attempts[0].preview.imagePath, path.join(sessionDir, "attempts", "001.preview.png"));
    assert.equal(summary.attempts[0].preview.metadataPath, path.join(sessionDir, "attempts", "001.preview.json"));
    assert.equal(summary.attempts[0].preview.url.endsWith("/preview"), true);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("generation session commands reject invalid bundle roots, duplicate sessions, invalid assessments, invalid reviews, and missing sessions", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-session-errors-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "demo-session");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: true });
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
      components: "partial",
      boundary: "weak",
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

    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: false });
    const warnAssessmentPath = path.join(tempRoot, "assessment-warn.json");
    await writeJson(
      warnAssessmentPath,
      buildAssessment({
        structure: "strong",
        components: "strong",
        boundary: "strong",
        visual: "partial",
        responsiveness: "strong",
        notes: "Warn attempt for invalid review coverage.",
      }),
    );
    const warnAttempt = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        warnAssessmentPath,
      ],
      tempRoot,
    );
    assert.equal(warnAttempt.exitCode, 0, warnAttempt.stderr);

    const invalidReviewPath = path.join(tempRoot, "review-invalid.json");
    await writeJson(invalidReviewPath, {
      status: "accepted",
      findingCodes: ["missing.code"],
      rationale: "This should fail because the finding code is wrong.",
    });
    const invalidReview = await runCli(
      [
        "review-generation-attempt",
        "--session-dir",
        sessionDir,
        "--attempt",
        "1",
        "--review-file",
        invalidReviewPath,
      ],
      tempRoot,
    );
    assert.equal(invalidReview.exitCode, 10);
    assert.match(invalidReview.stderr, /unknown finding code/);

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

test("capture-generation-preview rejects missing attempts, invalid URLs, and unsatisfied wait conditions", async (t) => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-preview-errors-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const sessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "preview-errors");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: true });
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
        "--session",
        "preview-errors",
      ],
      tempRoot,
    );
    assert.equal(initResult.exitCode, 0, initResult.stderr);

    const assessmentPath = path.join(tempRoot, "preview-errors-assessment.json");
    await writeJson(
      assessmentPath,
      buildAssessment({
        structure: "strong",
        components: "strong",
        boundary: "strong",
        visual: "strong",
        responsiveness: "strong",
        notes: "Recorded attempt for preview error cases.",
      }),
    );
    const recordResult = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        sessionDir,
        "--assessment-file",
        assessmentPath,
      ],
      tempRoot,
    );
    assert.equal(recordResult.exitCode, 0, recordResult.stderr);

    const missingAttempt = await runCli(
      [
        "capture-generation-preview",
        "--session-dir",
        sessionDir,
        "--attempt",
        "2",
        "--url",
        "https://example.com",
      ],
      tempRoot,
    );
    assert.equal(missingAttempt.exitCode, 10);
    assert.match(missingAttempt.stderr, /Attempt 2 not found/);

    const invalidUrl = await runCli(
      [
        "capture-generation-preview",
        "--session-dir",
        sessionDir,
        "--attempt",
        "1",
        "--url",
        "not-a-url",
      ],
      tempRoot,
    );
    assert.equal(invalidUrl.exitCode, 10);
    assert.match(invalidUrl.stderr, /absolute URL/);

    await ensureChromiumAvailable(t);
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><main><h1>Preview</h1></main></body></html>");
    }, async (origin) => {
      const waitFailure = await runCli(
        [
          "capture-generation-preview",
          "--session-dir",
          sessionDir,
          "--attempt",
          "1",
          "--url",
          `${origin}/preview`,
          "--wait-for",
          "Never appears",
        ],
        tempRoot,
      );
      assert.equal(waitFailure.exitCode, 10);
      assert.match(waitFailure.stderr, /wait condition/i);
    });
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
      schemaVersion: 3,
      surfaceId: "demo-surface",
      sessionId: "summary-session",
      tool: "codex",
      guidanceStrategy: "prompt-summary",
      workspaceRoot: tempRoot,
      sourceBundleRoot: path.join(tempRoot, "source-bundle"),
      sessionDir,
      bundleRoot: path.join(sessionDir, "bundle"),
      preparedInputPath: path.join(sessionDir, "prepared-input.json"),
      contractPath: path.join(sessionDir, "bundle", "contract", "normalized.json"),
      repairMapPath: path.join(bundleSurfaceDir, "repair-map.json"),
      guidanceArtifacts: {
        baseHandoffPath: path.join(sessionDir, "guidance-handoff.json"),
      },
      startedAt: "2026-03-12T00:00:00.000Z",
      successRule: { finalStatus: "pass-or-reviewed-warn" },
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
    await writeJson(
      path.join(sessionDir, "attempts", "001.assessment.json"),
      buildAssessment({
        structure: "partial",
        components: "partial",
        boundary: "partial",
        visual: "partial",
        responsiveness: "partial",
        notes: "Still missing the hero section.",
      }),
    );
    await writeJson(path.join(sessionDir, "attempts", "001.metadata.json"), {
      createdAt: "2026-03-12T00:00:00.000Z",
    });
    await writeJson(path.join(sessionDir, "attempts", "002.validate.json"), {
      status: "warn",
      findings: [{ code: "section.required.missing" }],
    });
    await writeJson(
      path.join(sessionDir, "attempts", "002.assessment.json"),
      buildAssessment({
        structure: "partial",
        components: "partial",
        boundary: "partial",
        visual: "strong",
        responsiveness: "strong",
        notes: "Section is still pending.",
      }),
    );
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
