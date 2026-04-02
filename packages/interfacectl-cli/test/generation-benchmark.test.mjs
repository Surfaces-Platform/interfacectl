import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateDiffOutput } from "@surfaces/interfacectl-validator";
import generationSessionComparisonSchema from "../schemas/generation-session-comparison.schema.json" with { type: "json" };
import contractDeltaSuggestionsSchema from "../schemas/contract-delta-suggestions.schema.json" with { type: "json" };
import generationBenchmarkReportSchema from "../schemas/generation-benchmark-report.schema.json" with { type: "json" };
import generationBenchmarkSpecSchema from "../schemas/generation-benchmark-spec.schema.json" with { type: "json" };
import generationBenchmarkRunSchema from "../schemas/generation-benchmark-run.schema.json" with { type: "json" };

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
    contractId: "generation-benchmark-demo",
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
  platformFit,
  notes,
  heuristics,
}) {
  return {
    structure,
    components,
    boundary,
    visual,
    responsiveness,
    platformFit: platformFit ?? responsiveness,
    notes,
    ...(heuristics ? { heuristics } : {}),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

test("strategy-aware benchmark artifacts compare sessions, emit deterministic suggestions, track reviewed decisions, and carry explicit preview refs", async (t) => {
  await ensureChromiumAvailable(t);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-benchmark-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const bundleRoot = path.join(tempRoot, "bundle");
  const baselineSessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "baseline-prompt-summary");
  const guidedSessionDir = path.join(workspaceRoot, "artifacts", "generation-sessions", "demo-surface", "guided-json-primary");
  const briefPath = path.join(tempRoot, "task-brief.md");

  try {
    await writeDemoWorkspace(workspaceRoot, { sectionValid: false, colorValid: true });
    await writeText(
      briefPath,
      "# Demo surface brief\nImplement the hero section for the demo surface using the existing page frame.\n",
    );

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

    for (const [sessionId, guidanceStrategy] of [
      ["baseline-prompt-summary", "prompt-summary"],
      ["guided-json-primary", "json-primary"],
    ]) {
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
          sessionId,
          "--guidance-strategy",
          guidanceStrategy,
          "--brief-file",
          briefPath,
        ],
        tempRoot,
      );
      assert.equal(initResult.exitCode, 0, initResult.stderr);
    }

    const baselineAssessmentOne = path.join(tempRoot, "baseline-1.json");
    await writeJson(
      baselineAssessmentOne,
      buildAssessment({
        structure: "weak",
        components: "weak",
        boundary: "weak",
        visual: "partial",
        responsiveness: "weak",
        notes: "Unguided baseline missed the contract markers on the first attempt.",
        heuristics: {
          unresolvedAcceptedSuggestionCount: 2,
          unresolvedAcceptedSuggestionRate: 1,
          noChangesAfterEditFailureCount: 1,
          recoverableToolErrorCount: 2,
        },
      }),
    );
    const baselineAttemptOne = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        baselineSessionDir,
        "--assessment-file",
        baselineAssessmentOne,
      ],
      tempRoot,
    );
    assert.equal(baselineAttemptOne.exitCode, 0, baselineAttemptOne.stderr);
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><main><h1>Baseline First</h1><p>ready</p></main></body></html>");
    }, async (origin) => {
      const previewResult = await runCli(
        [
          "capture-generation-preview",
          "--session-dir",
          baselineSessionDir,
          "--attempt",
          "1",
          "--url",
          `${origin}/baseline-first`,
          "--wait-for",
          "ready",
        ],
        tempRoot,
      );
      assert.equal(previewResult.exitCode, 0, previewResult.stderr);
    });

    await writeDemoWorkspace(workspaceRoot, { sectionValid: true, colorValid: false });
    const baselineAssessmentTwo = path.join(tempRoot, "baseline-2.json");
    await writeJson(
      baselineAssessmentTwo,
      buildAssessment({
        structure: "partial",
        components: "partial",
        boundary: "partial",
        visual: "partial",
        responsiveness: "partial",
        notes: "Baseline corrected the structure but still drifted on color.",
        heuristics: {
          unresolvedAcceptedSuggestionCount: 1,
          unresolvedAcceptedSuggestionRate: 0.5,
          noChangesAfterEditFailureCount: 1,
          recoverableToolErrorCount: 1,
          touchedFilesPerResolvedFinding: 2,
        },
      }),
    );
    const baselineAttemptTwo = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        baselineSessionDir,
        "--assessment-file",
        baselineAssessmentTwo,
      ],
      tempRoot,
    );
    assert.equal(baselineAttemptTwo.exitCode, 0, baselineAttemptTwo.stderr);
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><main><h1>Baseline Latest</h1><p>ready</p></main></body></html>");
    }, async (origin) => {
      const previewResult = await runCli(
        [
          "capture-generation-preview",
          "--session-dir",
          baselineSessionDir,
          "--attempt",
          "2",
          "--url",
          `${origin}/baseline-latest`,
          "--wait-for",
          "ready",
        ],
        tempRoot,
      );
      assert.equal(previewResult.exitCode, 0, previewResult.stderr);
    });

    const baselineWarnPayload = JSON.parse(
      await fsp.readFile(path.join(baselineSessionDir, "attempts", "002.validate.json"), "utf8"),
    );
    const baselineReviewFile = path.join(tempRoot, "baseline-review.json");
    await writeJson(baselineReviewFile, {
      status: "accepted",
      findingCodes: baselineWarnPayload.findings.map((entry) => entry.code).sort(),
      rationale: "The benchmark accepts the remaining baseline warning after review.",
    });
    const baselineReview = await runCli(
      [
        "review-generation-attempt",
        "--session-dir",
        baselineSessionDir,
        "--attempt",
        "2",
        "--review-file",
        baselineReviewFile,
      ],
      tempRoot,
    );
    assert.equal(baselineReview.exitCode, 0, baselineReview.stderr);

    const baselineSummary = await runCli(
      ["summarize-generation-session", "--session-dir", baselineSessionDir],
      tempRoot,
    );
    assert.equal(baselineSummary.exitCode, 0, baselineSummary.stderr);

    const guidedAssessmentOne = path.join(tempRoot, "guided-1.json");
    await writeJson(
      guidedAssessmentOne,
      buildAssessment({
        structure: "strong",
        components: "strong",
        boundary: "strong",
        visual: "partial",
        responsiveness: "strong",
        notes: "Guided attempt matched the structure but still carried a color warning.",
        heuristics: {
          unresolvedAcceptedSuggestionCount: 0,
          unresolvedAcceptedSuggestionRate: 0,
          noChangesAfterEditFailureCount: 0,
          recoverableToolErrorCount: 0,
          touchedFilesPerResolvedFinding: 1,
        },
      }),
    );
    const guidedAttemptOne = await runCli(
      [
        "record-generation-attempt",
        "--session-dir",
        guidedSessionDir,
        "--assessment-file",
        guidedAssessmentOne,
      ],
      tempRoot,
    );
    assert.equal(guidedAttemptOne.exitCode, 0, guidedAttemptOne.stderr);
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><main><h1>Guided First</h1><p>ready</p></main></body></html>");
    }, async (origin) => {
      const previewResult = await runCli(
        [
          "capture-generation-preview",
          "--session-dir",
          guidedSessionDir,
          "--attempt",
          "1",
          "--url",
          `${origin}/guided-first`,
          "--wait-for",
          "ready",
        ],
        tempRoot,
      );
      assert.equal(previewResult.exitCode, 0, previewResult.stderr);
    });

    const guidedWarnPayload = JSON.parse(
      await fsp.readFile(path.join(guidedSessionDir, "attempts", "001.validate.json"), "utf8"),
    );
    assert.equal(guidedWarnPayload.status, "warn");
    const guidedReviewFile = path.join(tempRoot, "guided-review.json");
    await writeJson(guidedReviewFile, {
      status: "accepted",
      findingCodes: guidedWarnPayload.findings.map((entry) => entry.code).sort(),
      rationale: "The remaining guided warning is acceptable for this benchmark.",
    });
    const guidedReview = await runCli(
      [
        "review-generation-attempt",
        "--session-dir",
        guidedSessionDir,
        "--attempt",
        "1",
        "--review-file",
        guidedReviewFile,
      ],
      tempRoot,
    );
    assert.equal(guidedReview.exitCode, 0, guidedReview.stderr);

    const guidedSummary = await runCli(
      ["summarize-generation-session", "--session-dir", guidedSessionDir],
      tempRoot,
    );
    assert.equal(guidedSummary.exitCode, 0, guidedSummary.stderr);

    const compareResult = await runCli(
      [
        "compare-generation-sessions",
        "--baseline-session-dir",
        baselineSessionDir,
        "--guided-session-dir",
        guidedSessionDir,
      ],
      tempRoot,
    );
    assert.equal(compareResult.exitCode, 0, compareResult.stderr);
    const compareOutput = JSON.parse(compareResult.stdout);
    const comparison = JSON.parse(await fsp.readFile(compareOutput.paths.jsonPath, "utf8"));
    validateWithSchema(comparison, generationSessionComparisonSchema, "generation session comparison");
    assert.equal(comparison.baseline.guidanceStrategy, "prompt-summary");
    assert.equal(comparison.guided.guidanceStrategy, "json-primary");
    assert.equal(Boolean(comparison.baseline.firstAttempt.preview), true);
    assert.equal(Boolean(comparison.baseline.latestAttempt.preview), true);
    assert.equal(Boolean(comparison.guided.firstAttempt.preview), true);
    assert.equal(comparison.baseline.firstAttempt.preview.metadataPath.endsWith(".preview.json"), true);
    assert.equal(comparison.guided.latestAttempt.preview.imagePath.endsWith(".preview.png"), true);
    assert.equal(comparison.checks.meetsGoal, true);
    assert.equal(comparison.delta.firstAttemptBlockingFindingCountDelta < 0, true);
    assert.equal(comparison.delta.attemptsToAcceptableOutcome.baseline, 2);
    assert.equal(comparison.delta.attemptsToAcceptableOutcome.guided, 1);
    assert.equal(comparison.heuristics.delta.unresolvedAcceptedSuggestionRate < 0, true);
    assert.equal(comparison.heuristics.delta.recoverableToolErrorCount < 0, true);

    const contractPath = path.join(workspaceRoot, "contracts", "generated", "demo-surface.contract.json");
    const contractBeforeReview = await fsp.readFile(contractPath);

    const suggestionOutOne = path.join(tempRoot, "suggestions-1.json");
    const suggestionResultOne = await runCli(
      [
        "suggest-contract-deltas",
        "--session-dir",
        guidedSessionDir,
        "--out",
        suggestionOutOne,
      ],
      tempRoot,
    );
    assert.equal(suggestionResultOne.exitCode, 0, suggestionResultOne.stderr);
    const suggestionsOne = JSON.parse(await fsp.readFile(suggestionOutOne, "utf8"));
    validateWithSchema(suggestionsOne, contractDeltaSuggestionsSchema, "contract delta suggestions");
    assert.equal(suggestionsOne.suggestions.length > 0, true);

    const suggestionOutTwo = path.join(tempRoot, "suggestions-2.json");
    const suggestionResultTwo = await runCli(
      [
        "suggest-contract-deltas",
        "--session-dir",
        guidedSessionDir,
        "--out",
        suggestionOutTwo,
      ],
      tempRoot,
    );
    assert.equal(suggestionResultTwo.exitCode, 0, suggestionResultTwo.stderr);
    const suggestionsOneBytes = await fsp.readFile(suggestionOutOne, "utf8");
    const suggestionsTwoBytes = await fsp.readFile(suggestionOutTwo, "utf8");
    assert.equal(sha256(suggestionsOneBytes), sha256(suggestionsTwoBytes));

    const decisionsPath = path.join(tempRoot, "suggestion-decisions.json");
    await writeJson(decisionsPath, {
      decisions: [
        {
          suggestionId: suggestionsOne.suggestions[0].suggestionId,
          status: "accepted",
          rationale: "We want to review this contract path next.",
        },
      ],
    });
    const reviewedSuggestionsPath = path.join(tempRoot, "suggestions-reviewed.json");
    const reviewSuggestions = await runCli(
      [
        "review-contract-delta-suggestions",
        "--suggestions",
        suggestionOutOne,
        "--review-file",
        decisionsPath,
        "--out",
        reviewedSuggestionsPath,
      ],
      tempRoot,
    );
    assert.equal(reviewSuggestions.exitCode, 0, reviewSuggestions.stderr);
    const reviewedSuggestions = JSON.parse(await fsp.readFile(reviewedSuggestionsPath, "utf8"));
    validateWithSchema(reviewedSuggestions, contractDeltaSuggestionsSchema, "reviewed contract delta suggestions");
    assert.equal(reviewedSuggestions.suggestions[0].status, "accepted");
    assert.equal(reviewedSuggestions.suggestions[0].decision.rationale, "We want to review this contract path next.");

    const contractAfterReview = await fsp.readFile(contractPath);
    assert.equal(sha256(contractBeforeReview), sha256(contractAfterReview));

    const benchmarkOutDir = path.join(tempRoot, "benchmark-report");
    const benchmarkResult = await runCli(
      [
        "summarize-generation-benchmark",
        "--comparisons",
        compareOutput.paths.jsonPath,
        "--suggestions",
        reviewedSuggestionsPath,
        "--out-dir",
        benchmarkOutDir,
      ],
      tempRoot,
    );
    assert.equal(benchmarkResult.exitCode, 0, benchmarkResult.stderr);
    const benchmarkOutput = JSON.parse(benchmarkResult.stdout);
    const benchmarkReport = JSON.parse(await fsp.readFile(benchmarkOutput.paths.jsonPath, "utf8"));
    validateWithSchema(benchmarkReport, generationBenchmarkReportSchema, "generation benchmark report");
    assert.equal(benchmarkReport.overall.surfaceCount, 1);
    assert.equal(benchmarkReport.overall.surfacesMeetingGoal, 1);
    assert.equal(benchmarkReport.overall.acceptedSuggestionCount, 1);
    assert.equal(benchmarkReport.comparisons[0].baselineGuidanceStrategy, "prompt-summary");
    assert.equal(benchmarkReport.comparisons[0].guidedGuidanceStrategy, "json-primary");
    assert.equal(benchmarkReport.overall.heuristics.lowerRecoverableToolErrorCount, 1);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("replay-generation-benchmark freezes a copied spec and model attribution into a new run manifest", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-benchmark-replay-"));
  const specPath = path.join(tempRoot, "spec.json");
  const outDir = path.join(tempRoot, "replay-run");

  try {
    const spec = {
      schemaVersion: 1,
      specId: "demo-suite/spec",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evaluationMode: "zero-shot",
      attemptBudget: 1,
      guidanceStrategies: ["unguided", "baseline-primary", "json-primary"],
      comparisonPairs: [
        {
          baselineGuidanceStrategy: "unguided",
          guidedGuidanceStrategy: "baseline-primary",
        },
        {
          baselineGuidanceStrategy: "baseline-primary",
          guidedGuidanceStrategy: "json-primary",
        },
      ],
      suiteId: "demo-suite/default",
      suiteName: "Demo Suite",
      fixtures: [
        {
          fixtureId: "demo-surface",
          surfaceId: "demo-surface",
          brief: {
            path: "/tmp/demo-brief.md",
            sha256: "brief-hash",
          },
          platformTarget: "web",
          consumerType: "desktop-shell",
          capturePreset: "desktop-shell",
          comparisonPairs: [
            {
              baselineGuidanceStrategy: "unguided",
              guidedGuidanceStrategy: "baseline-primary",
            },
            {
              baselineGuidanceStrategy: "baseline-primary",
              guidedGuidanceStrategy: "json-primary",
            },
          ],
        },
      ],
    };
    await writeJson(specPath, spec);
    validateWithSchema(spec, generationBenchmarkSpecSchema, "generation benchmark spec");

    const replayResult = await runCli(
      [
        "replay-generation-benchmark",
        "--spec",
        specPath,
        "--tool",
        "local-llm",
        "--out-dir",
        outDir,
        "--cohort-id",
        "20260402000000",
        "--requested-model-label",
        "gpt-oss-20b",
        "--resolved-model-id",
        "openai/gpt-oss-20b",
        "--base-url",
        "http://127.0.0.1:1234/v1",
        "--fingerprint",
        "gpt-oss-20b-fingerprint",
      ],
      tempRoot,
    );
    assert.equal(replayResult.exitCode, 0, replayResult.stderr);

    const replayOutput = JSON.parse(replayResult.stdout);
    const replayRun = JSON.parse(await fsp.readFile(replayOutput.paths.runPath, "utf8"));
    validateWithSchema(replayRun, generationBenchmarkRunSchema, "generation benchmark run");
    assert.equal(replayRun.sourceSpecPath, specPath);
    assert.equal(replayRun.paths.specPath, path.join(outDir, "spec.json"));
    assert.equal(replayRun.model.requestedModelLabel, "gpt-oss-20b");
    assert.equal(replayRun.model.resolvedModelId, "openai/gpt-oss-20b");
    assert.equal(replayRun.fixtures[0].consumerType, "desktop-shell");
    assert.deepEqual(replayRun.fixtures[0].comparisons, []);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("summarize-generation-benchmark emits a report from run evidence even when no comparisons completed", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "interfacectl-generation-benchmark-evidence-only-"));
  const specPath = path.join(tempRoot, "spec.json");
  const outDir = path.join(tempRoot, "replay-run");
  const reportDir = path.join(tempRoot, "benchmark-report");

  try {
    const spec = {
      schemaVersion: 1,
      specId: "demo-suite/spec",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evaluationMode: "zero-shot",
      attemptBudget: 1,
      guidanceStrategies: ["unguided", "baseline-primary"],
      comparisonPairs: [
        {
          baselineGuidanceStrategy: "unguided",
          guidedGuidanceStrategy: "baseline-primary",
        },
      ],
      suiteId: "demo-suite/default",
      suiteName: "Demo Suite",
      fixtures: [
        {
          fixtureId: "demo-surface",
          surfaceId: "demo-surface",
          brief: {
            path: "/tmp/demo-brief.md",
            sha256: "brief-hash",
          },
          platformTarget: "web",
          consumerType: "web-browser",
          capturePreset: "web-browser",
          comparisonPairs: [
            {
              baselineGuidanceStrategy: "unguided",
              guidedGuidanceStrategy: "baseline-primary",
            },
          ],
        },
      ],
    };
    await writeJson(specPath, spec);

    const replayResult = await runCli(
      [
        "replay-generation-benchmark",
        "--spec",
        specPath,
        "--tool",
        "local-llm",
        "--out-dir",
        outDir,
        "--cohort-id",
        "20260402000001",
        "--requested-model-label",
        "gpt-oss-20b",
        "--resolved-model-id",
        "openai/gpt-oss-20b",
        "--base-url",
        "http://127.0.0.1:1234/v1",
        "--fingerprint",
        "gpt-oss-20b-fingerprint",
      ],
      tempRoot,
    );
    assert.equal(replayResult.exitCode, 0, replayResult.stderr);

    const replayOutput = JSON.parse(replayResult.stdout);
    const replayRun = JSON.parse(await fsp.readFile(replayOutput.paths.runPath, "utf8"));
    const sessionRoot = path.join(tempRoot, "sessions");
    const runWithSessionsPath = path.join(outDir, "run-with-sessions.json");
    const runWithSessions = {
      ...replayRun,
      fixtures: replayRun.fixtures.map((fixture) => ({
        ...fixture,
        sessions: [
          {
            guidanceStrategy: "unguided",
            sessionId: `${fixture.surfaceId}/unguided`,
            sessionDir: path.join(sessionRoot, fixture.surfaceId, "unguided"),
            summaryPath: path.join(sessionRoot, fixture.surfaceId, "unguided", "summary.json"),
            guidanceHandoffPath: path.join(sessionRoot, fixture.surfaceId, "unguided", "guidance-handoff.txt"),
            agentInputPath: path.join(sessionRoot, fixture.surfaceId, "unguided", "agent-input.txt"),
            previewPath: null,
          },
          {
            guidanceStrategy: "baseline-primary",
            sessionId: `${fixture.surfaceId}/baseline-primary`,
            sessionDir: path.join(sessionRoot, fixture.surfaceId, "baseline-primary"),
            summaryPath: path.join(sessionRoot, fixture.surfaceId, "baseline-primary", "summary.json"),
            guidanceHandoffPath: path.join(sessionRoot, fixture.surfaceId, "baseline-primary", "guidance-handoff.txt"),
            agentInputPath: path.join(sessionRoot, fixture.surfaceId, "baseline-primary", "agent-input.txt"),
            previewPath: null,
          },
        ],
      })),
    };
    await writeJson(runWithSessionsPath, runWithSessions);
    const [unguidedSession, baselineSession] = runWithSessions.fixtures[0].sessions;

    await writeJson(unguidedSession.summaryPath, {
      schemaVersion: 1,
      sessionId: unguidedSession.sessionId,
      surfaceId: runWithSessions.fixtures[0].surfaceId,
      guidanceStrategy: "unguided",
      latestStatus: "warn",
      latestOutcome: "warn",
      attempts: [],
    });
    await writeJson(baselineSession.summaryPath, {
      schemaVersion: 1,
      sessionId: baselineSession.sessionId,
      surfaceId: runWithSessions.fixtures[0].surfaceId,
      guidanceStrategy: "baseline-primary",
      latestStatus: "block",
      latestOutcome: "error",
      errorMessage: "Model crashed during compile.",
      attempts: [],
    });

    const benchmarkResult = await runCli(
      [
        "summarize-generation-benchmark",
        "--run-path",
        runWithSessionsPath,
        "--out-dir",
        reportDir,
      ],
      tempRoot,
    );
    assert.equal(benchmarkResult.exitCode, 0, benchmarkResult.stderr);

    const benchmarkOutput = JSON.parse(benchmarkResult.stdout);
    const benchmarkReport = JSON.parse(await fsp.readFile(benchmarkOutput.paths.jsonPath, "utf8"));
    validateWithSchema(benchmarkReport, generationBenchmarkReportSchema, "generation benchmark report");
    assert.equal(benchmarkReport.overall.surfaceCount, 1);
    assert.deepEqual(benchmarkReport.comparisons, []);

    const markdown = await fsp.readFile(benchmarkOutput.paths.markdownPath, "utf8");
    assert.match(markdown, /## Comparisons\n- none/);
    assert.match(markdown, /- error: Model crashed during compile\./);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});
