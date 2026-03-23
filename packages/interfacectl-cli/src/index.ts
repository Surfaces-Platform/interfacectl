#!/usr/bin/env node

import { Command } from "commander";
import { runBareWelcomeFlow, shouldLaunchBareWelcomeFlow } from "./utils/bare-onboarding.js";
import { runValidateCommand } from "./commands/validate.js";
import { runDiffCommand } from "./commands/diff.js";
import { runEnforceCommand } from "./commands/enforce.js";
import { runCompileCommand } from "./commands/compile.js";
import { runGenerateContractCommand } from "./commands/generate-contract.js";
import { runMigrateColorPolicyCommand } from "./commands/migrate-color-policy.js";
import { runValidateExtractedCommand } from "./commands/validate-extracted.js";
import { runDescribeCommand } from "./commands/describe.js";
import { runPrepareGenerationCommand } from "./commands/prepare-generation.js";
import { runPrepareRuntimeCommand } from "./commands/prepare-runtime.js";
import { runValidateGenerationCommand } from "./commands/validate-generation.js";
import { runServeGenerationAdapterCommand } from "./commands/serve-generation-adapter.js";
import { runEmitRunArtifactCommand } from "./commands/emit-run-artifact.js";
import {
  runCaptureGenerationPreviewCommand,
  runCompareGenerationSessionsCommand,
  runInitGenerationSessionCommand,
  runPrepareGenerationHandoffCommand,
  runRecordGenerationAttemptCommand,
  runReviewContractDeltaSuggestionsCommand,
  runReviewGenerationAttemptCommand,
  runSuggestContractDeltasCommand,
  runSummarizeGenerationSessionCommand,
  runSummarizeGenerationBenchmarkCommand,
} from "./commands/generation-session.js";
import { runInitCommand } from "./commands/init.js";
import { runAnalyzeCommand } from "./commands/analyze.js";
import {
  runAuthCaptureCommand,
  runAuthClearCommand,
  runAuthListCommandWithOptions,
  runAuthTestCommand,
} from "./commands/auth.js";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name("interfacectl")
  .description("Interface contract tooling for Surfaces")
  .version(pkg.version ?? "0.0.0");

program
  .command("validate")
  .description("Validate configured surfaces against the shared interface contract")
  .option(
    "--contract <path>",
    "Path to the contract JSON file",
  )
  .option(
    "--schema <path>",
    "Optional path to the contract schema JSON file",
  )
  .option(
    "--config <path>",
    "Optional path to the interfacectl config JSON file (defaults to interfacectl.config.json)",
  )
  .option("--root <path>", "Project root (defaults to current working directory)")
  .option(
    "--workspace-root <path>",
    "Workspace root (defaults to current working directory)",
  )
  .option(
    "--surface <id...>",
    "Limit validation to the provided surface identifiers",
  )
  .option(
    "--remote-url <url>",
    "Augment validation with browser-observed target, flow, and async-state metrics from the provided URL",
  )
  .option(
    "--json",
    "Emit machine-readable JSON instead of human-readable text output",
  )
  .option("--format <format>", "Output format (text|json)")
  .option("--out <path>", "Write output to the provided file path instead of stdout")
  .option("--exit-codes <v1|v2>", "Exit code version (default: v1, use v2 for new contract)")
  .action(async (options) => {
    const env = process.env;
    const requestedRoot =
      options.root ?? options.workspaceRoot ?? env.SURFACES_ROOT;
    const workspaceRoot =
      typeof requestedRoot === "string" && requestedRoot.length > 0
        ? requestedRoot
        : undefined;
    const requestedContract =
      options.contract ?? env.SURFACES_CONTRACT ?? undefined;
    const contractPath =
      typeof requestedContract === "string" && requestedContract.length > 0
        ? requestedContract
        : "contracts/surfaces.web.contract.json";
    const requestedConfig =
      options.config ?? env.SURFACES_CONFIG ?? undefined;
    const formatInput = (
      options.format ?? (options.json ? "json" : undefined)
    )?.toLowerCase();
    const outputFormat =
      formatInput === "json" ? "json" : formatInput === "text" ? "text" : "text";

    if (
      formatInput &&
      formatInput !== "text" &&
      formatInput !== "json"
    ) {
      console.error(
        `Invalid format "${options.format}". Expected "text" or "json".`,
      );
      process.exitCode = 1;
      return;
    }

    const exitCodeVersion =
      options.exitCodes === "v1" || options.exitCodes === "v2"
        ? options.exitCodes
        : undefined;

    const exitCode = await runValidateCommand({
      contractPath,
      schemaPath: options.schema,
      workspaceRoot,
      surfaceFilters: options.surface ?? [],
      remoteUrl: options.remoteUrl,
      outputFormat,
      outputPath: options.out,
      configPath: requestedConfig,
      configProvided: Boolean(requestedConfig),
      exitCodes: exitCodeVersion,
    });

    process.exitCode = exitCode;
  });

program
  .command("diff")
  .description("Compare contract against observed artifacts")
  .option("--contract <path>", "Path to the contract JSON file")
  .option("--schema <path>", "Optional path to the contract schema JSON file")
  .option(
    "--config <path>",
    "Optional path to the interfacectl config JSON file (defaults to interfacectl.config.json)",
  )
  .option("--root <path>", "Project root (defaults to current working directory)")
  .option(
    "--workspace-root <path>",
    "Workspace root (defaults to current working directory)",
  )
  .option(
    "--surface <id...>",
    "Limit validation to the provided surface identifiers",
  )
  .option(
    "--json",
    "Emit machine-readable JSON instead of human-readable text output",
  )
  .option("--format <format>", "Output format (text|json)")
  .option("--out <path>", "Write output to the provided file path instead of stdout")
  .option("--no-normalize", "Disable normalization (for debugging)")
  .option("--rename-threshold <0-1>", "Rename detection threshold (default: 0.8)", parseFloat)
  .option("--policy <path>", "Optional policy path (for policy metadata in output)")
  .option("--exit-codes <v1|v2>", "Exit code version (default: v1, use v2 for new contract)")
  .action(async (options) => {
    const env = process.env;
    const requestedRoot =
      options.root ?? options.workspaceRoot ?? env.SURFACES_ROOT;
    const workspaceRoot =
      typeof requestedRoot === "string" && requestedRoot.length > 0
        ? requestedRoot
        : undefined;
    const requestedContract =
      options.contract ?? env.SURFACES_CONTRACT ?? undefined;
    const contractPath =
      typeof requestedContract === "string" && requestedContract.length > 0
        ? requestedContract
        : "contracts/surfaces.web.contract.json";
    const requestedConfig =
      options.config ?? env.SURFACES_CONFIG ?? undefined;
    const formatInput = (
      options.format ?? (options.json ? "json" : undefined)
    )?.toLowerCase();
    const outputFormat =
      formatInput === "json" ? "json" : formatInput === "text" ? "text" : "text";

    if (
      formatInput &&
      formatInput !== "text" &&
      formatInput !== "json"
    ) {
      console.error(
        `Invalid format "${options.format}". Expected "text" or "json".`,
      );
      process.exitCode = 1;
      return;
    }

    const exitCodeVersion =
      options.exitCodes === "v1" || options.exitCodes === "v2"
        ? options.exitCodes
        : undefined;

    const exitCode = await runDiffCommand({
      contractPath,
      schemaPath: options.schema,
      workspaceRoot,
      surfaceFilters: options.surface ?? [],
      outputFormat,
      outputPath: options.out,
      configPath: requestedConfig,
      configProvided: Boolean(requestedConfig),
      normalize: options.normalize !== false,
      renameThreshold: options.renameThreshold,
      policyPath: options.policy,
      exitCodes: exitCodeVersion,
    });

    process.exitCode = exitCode;
  });

program
  .command("enforce")
  .description("Enforce policy on interface contract")
  .option("--mode <fail|fix|pr>", "Enforcement mode (default: fail)")
  .option("--strict", "Alias for --mode fail (strict enforcement)")
  .option("--policy <path>", "Policy JSON path (optional, uses default if not provided)")
  .option("--contract <path>", "Contract path")
  .option("--root <path>", "Workspace root")
  .option("--config <path>", "Config path")
  .option("--surface <id...>", "Filter surfaces")
  .option("--dry-run", "For fix mode, show what would change")
  .option("--format <text|json>", "Output format")
  .option("--out <path>", "Output file")
  .option("--json", "Emit machine-readable JSON instead of human-readable text output")
  .option("--exit-codes <v1|v2>", "Exit code version (default: v1, use v2 for new contract)")
  .action(async (options) => {
    const env = process.env;
    const requestedRoot =
      options.root ?? env.SURFACES_ROOT;
    const workspaceRoot =
      typeof requestedRoot === "string" && requestedRoot.length > 0
        ? requestedRoot
        : undefined;
    const requestedContract =
      options.contract ?? env.SURFACES_CONTRACT ?? undefined;
    const requestedConfig =
      options.config ?? env.SURFACES_CONFIG ?? undefined;
    const formatInput = (
      options.format ?? (options.json ? "json" : undefined)
    )?.toLowerCase();
    const outputFormat =
      formatInput === "json" ? "json" : formatInput === "text" ? "text" : "text";

    if (
      formatInput &&
      formatInput !== "text" &&
      formatInput !== "json"
    ) {
      console.error(
        `Invalid format "${options.format}". Expected "text" or "json".`,
      );
      process.exitCode = 1;
      return;
    }

    const exitCodeVersion =
      options.exitCodes === "v1" || options.exitCodes === "v2"
        ? options.exitCodes
        : undefined;

    const exitCode = await runEnforceCommand({
      mode: options.mode,
      strict: options.strict,
      policyPath: options.policy,
      contractPath: requestedContract,
      workspaceRoot,
      surfaceFilters: options.surface ?? [],
      outputFormat,
      outputPath: options.out,
      configPath: requestedConfig,
      configProvided: Boolean(options.config),
      dryRun: options.dryRun,
      exitCodes: exitCodeVersion,
    });

    process.exitCode = exitCode;
  });

program
  .command("compile")
  .description("Produce a deterministic directory bundle for runtime consumption")
  .requiredOption("--contract <path>", "Path to the contract JSON file")
  .requiredOption("--out <dir>", "Output directory for the bundle")
  .option("--schema <path>", "Optional path to the contract schema JSON file")
  .option("--format <format>", "Output format (json)")
  .action(async (options) => {
    const exitCode = await runCompileCommand(
      {
        contractPath: options.contract,
        outDir: options.out,
        schemaPath: options.schema,
        format: options.format,
      },
      pkg.version ?? "0.0.0",
    );
    process.exitCode = exitCode;
  });

program
  .command("prepare-generation")
  .description("Resolve a compiled generation bundle into one agent-ready JSON payload")
  .requiredOption("--bundle-root <path>", "Path to the compiled generation bundle directory")
  .requiredOption("--surface <id>", "Surface identifier")
  .option("--out <path>", "Write the prepared JSON payload to the provided file")
  .action(async (options) => {
    process.exitCode = await runPrepareGenerationCommand({
      bundleRoot: options.bundleRoot,
      surfaceId: options.surface,
      outPath: options.out,
    });
  });

program
  .command("prepare-runtime")
  .description("Resolve a compiled runtime bundle into one adapter-ready JSON payload")
  .requiredOption("--bundle-root <path>", "Path to the compiled bundle directory")
  .requiredOption("--surface <id>", "Surface identifier")
  .option("--out <path>", "Write the prepared JSON payload to the provided file")
  .action(async (options) => {
    process.exitCode = await runPrepareRuntimeCommand({
      bundleRoot: options.bundleRoot,
      surfaceId: options.surface,
      outPath: options.out,
    });
  });

program
  .command("init-generation-session")
  .description("Freeze one compiled bundle revision into a tracked local generation session")
  .requiredOption("--bundle-root <path>", "Path to the compiled generation bundle directory")
  .requiredOption("--surface <id>", "Surface identifier")
  .requiredOption("--workspace-root <path>", "Workspace root for emitted run artifacts")
  .option("--tool <tool>", "Generation tool identifier (codex|cursor|local-llm)")
  .option("--guidance-strategy <strategy>", "Session guidance strategy (prompt-summary|json-primary|unguided)")
  .option("--guidance-mode <mode>", "Legacy alias for --guidance-strategy (prepared|unguided)")
  .option("--brief-file <path>", "Optional implementation brief file to freeze into the session")
  .option("--session <id>", "Optional session identifier")
  .option("--artifacts-root <path>", "Optional session artifacts root (defaults under workspaceRoot/artifacts/generation-sessions)")
  .action(async (options) => {
    process.exitCode = await runInitGenerationSessionCommand({
      bundleRoot: options.bundleRoot,
      surfaceId: options.surface,
      workspaceRoot: options.workspaceRoot,
      tool: options.tool,
      guidanceStrategy: options.guidanceStrategy,
      guidanceMode: options.guidanceMode,
      briefFile: options.briefFile,
      sessionId: options.session,
      artifactsRoot: options.artifactsRoot,
    });
  });

program
  .command("prepare-generation-handoff")
  .description("Build one canonical strategy-aware guidance handoff artifact for a tracked generation session")
  .requiredOption("--session-dir <path>", "Path to the generation session directory")
  .option("--guidance-strategy <strategy>", "Optional guidance strategy override (prompt-summary|json-primary|unguided)")
  .option("--accepted-suggestions <path>", "Optional accepted suggestions JSON file")
  .option("--designer-notes <path>", "Optional designer notes JSON file")
  .option("--finding-codes <codes>", "Optional comma-separated finding codes to match against repair guidance")
  .option("--out <path>", "Write the handoff JSON to the provided file")
  .action(async (options) => {
    process.exitCode = await runPrepareGenerationHandoffCommand({
      sessionDir: options.sessionDir,
      guidanceStrategy: options.guidanceStrategy,
      acceptedSuggestionsFile: options.acceptedSuggestions,
      designerNotesFile: options.designerNotes,
      findingCodes: options.findingCodes,
      outPath: options.out,
    });
  });

program
  .command("record-generation-attempt")
  .description("Validate and record one generation attempt for a tracked session")
  .requiredOption("--session-dir <path>", "Path to the generation session directory")
  .requiredOption("--assessment-file <path>", "Path to the assessment JSON file")
  .action(async (options) => {
    process.exitCode = await runRecordGenerationAttemptCommand({
      sessionDir: options.sessionDir,
      assessmentFile: options.assessmentFile,
    });
  });

program
  .command("capture-generation-preview")
  .description("Capture a visual preview for one recorded generation attempt")
  .requiredOption("--session-dir <path>", "Path to the generation session directory")
  .requiredOption("--attempt <number>", "Attempt number to capture")
  .requiredOption("--url <url>", "Absolute preview URL to capture")
  .option("--wait-for <value>", "Optional text or selector to wait for before capturing")
  .option("--storage-state <path>", "Optional Playwright storage state JSON file for authenticated previews")
  .action(async (options) => {
    process.exitCode = await runCaptureGenerationPreviewCommand({
      sessionDir: options.sessionDir,
      attemptNumber: options.attempt,
      url: options.url,
      waitFor: options.waitFor,
      storageStatePath: options.storageState,
    });
  });

program
  .command("review-generation-attempt")
  .description("Review the remaining findings for one warn attempt in a tracked generation session")
  .requiredOption("--session-dir <path>", "Path to the generation session directory")
  .requiredOption("--attempt <number>", "Attempt number to review")
  .requiredOption("--review-file <path>", "Path to the review JSON file")
  .action(async (options) => {
    process.exitCode = await runReviewGenerationAttemptCommand({
      sessionDir: options.sessionDir,
      attemptNumber: options.attempt,
      reviewFile: options.reviewFile,
    });
  });

program
  .command("summarize-generation-session")
  .description("Aggregate recorded generation attempts for a tracked session")
  .requiredOption("--session-dir <path>", "Path to the generation session directory")
  .action(async (options) => {
    process.exitCode = await runSummarizeGenerationSessionCommand({
      sessionDir: options.sessionDir,
    });
  });

program
  .command("compare-generation-sessions")
  .description("Compare two generation sessions for the same frozen brief")
  .requiredOption("--baseline-session-dir <path>", "Path to the baseline generation session directory")
  .requiredOption("--guided-session-dir <path>", "Path to the candidate generation session directory")
  .option("--out-dir <path>", "Output directory for comparison artifacts")
  .action(async (options) => {
    process.exitCode = await runCompareGenerationSessionsCommand({
      baselineSessionDir: options.baselineSessionDir,
      guidedSessionDir: options.guidedSessionDir,
      outDir: options.outDir,
    });
  });

program
  .command("suggest-contract-deltas")
  .description("Generate evidence-backed contract refinement suggestions from one guided generation session")
  .requiredOption("--session-dir <path>", "Path to the guided generation session directory")
  .option("--out <path>", "Write suggestion JSON to the provided file")
  .action(async (options) => {
    process.exitCode = await runSuggestContractDeltasCommand({
      sessionDir: options.sessionDir,
      outPath: options.out,
    });
  });

program
  .command("review-contract-delta-suggestions")
  .description("Apply human accept/reject decisions to contract delta suggestions without mutating the contract")
  .requiredOption("--suggestions <path>", "Path to the contract delta suggestions JSON file")
  .requiredOption("--review-file <path>", "Path to the review decisions JSON file")
  .option("--out <path>", "Write the updated suggestions JSON to the provided file")
  .action(async (options) => {
    process.exitCode = await runReviewContractDeltaSuggestionsCommand({
      suggestionsPath: options.suggestions,
      reviewFile: options.reviewFile,
      outPath: options.out,
    });
  });

program
  .command("summarize-generation-benchmark")
  .description("Aggregate one or more comparison and suggestion artifacts into a benchmark report")
  .requiredOption("--comparisons <paths>", "Comma-separated generation session comparison JSON paths")
  .option("--suggestions <paths>", "Comma-separated contract delta suggestion JSON paths")
  .option("--out-dir <path>", "Output directory for the benchmark report")
  .action(async (options) => {
    process.exitCode = await runSummarizeGenerationBenchmarkCommand({
      comparisonPaths: options.comparisons,
      suggestionPaths: options.suggestions,
      outDir: options.outDir,
    });
  });

program
  .command("validate-generation")
  .description("Validate generated UI against a compiled generation bundle")
  .requiredOption("--tool <tool>", "Generator tool identifier")
  .requiredOption("--surface <id>", "Surface identifier")
  .requiredOption("--mode <workspace|descriptor>", "Validation mode")
  .requiredOption("--bundle-root <path>", "Path to the compiled generation bundle directory")
  .option("--workspace-root <path>", "Required when mode=workspace")
  .option("--descriptor-path <path>", "Required when mode=descriptor")
  .option("--descriptor-parity-config <path>", "Optional descriptor parity config path")
  .option("--out <path>", "Write output JSON to the provided file")
  .option("--request-id <id>", "Optional request identifier")
  .action(async (options) => {
    process.exitCode = await runValidateGenerationCommand({
      tool: options.tool,
      surfaceId: options.surface,
      mode: options.mode,
      bundleRoot: options.bundleRoot,
      workspaceRoot: options.workspaceRoot,
      descriptorPath: options.descriptorPath,
      descriptorParityConfigPath: options.descriptorParityConfig,
      outPath: options.out,
      requestId: options.requestId,
    });
  });

program
  .command("serve-generation-adapter")
  .description("Serve the generation adapter over HTTP for a compiled generation bundle")
  .requiredOption("--bundle-root <path>", "Path to the compiled generation bundle directory")
  .option("--host <host>", "Bind host (default: 127.0.0.1)")
  .option("--port <port>", "Bind port (default: 7777)")
  .option("--token <value>", "Optional auth token")
  .option("--token-header <name>", "Token header name (default: x-surfaces-adapter-token)")
  .option("--descriptor-parity-config <path>", "Optional descriptor parity config path")
  .action(async (options) => {
    await runServeGenerationAdapterCommand({
      host: options.host,
      port: options.port ? Number(options.port) : undefined,
      token: options.token,
      tokenHeader: options.tokenHeader,
      bundleRoot: options.bundleRoot,
      descriptorParityConfigPath: options.descriptorParityConfig,
    });
  });

program
  .command("emit-run-artifact")
  .description("Emit one canonical run artifact into contracts/generated")
  .requiredOption("--workspace-root <path>", "Workspace root for contracts/generated")
  .requiredOption("--surface <id>", "Surface identifier")
  .requiredOption("--source <bootstrap|generation|ci|runtime>", "Run source")
  .requiredOption("--status <pass|warn|fail|unknown>", "Run status")
  .option("--contract <path>", "Optional contract path override")
  .option("--extraction-path <path>", "Optional extraction artifact path")
  .option("--report-path <path>", "Optional report artifact path")
  .option("--finding-codes <csv>", "Optional comma-separated finding codes")
  .option("--workspace-id <id>", "Optional workspace identifier")
  .option("--idempotency-key <key>", "Optional idempotency key")
  .option("--created-at <timestamp>", "Optional created-at timestamp")
  .option("--run-id <id>", "Optional run identifier")
  .action(async (options) => {
    process.exitCode = await runEmitRunArtifactCommand({
      workspaceRoot: options.workspaceRoot,
      surfaceId: options.surface,
      source: options.source,
      status: options.status,
      contractPath: options.contract,
      extractionPath: options.extractionPath,
      reportPath: options.reportPath,
      findingCodes: options.findingCodes,
      workspaceId: options.workspaceId,
      idempotencyKey: options.idempotencyKey,
      createdAt: options.createdAt,
      runId: options.runId,
    });
  });

program
  .command("generate-contract")
  .description("Extract a contract from a Next.js app (Phase 0: extraction only)")
  .requiredOption("--app-root <path>", "Path to the Next.js app root (directory containing app/)")
  .requiredOption("--surface <id>", "Surface identifier (e.g. surfaces-web)")
  .option(
    "--out <path>",
    `Output path for contract JSON (default: contracts/generated/<surfaceId>.contract.json)`,
  )
  .option(
    "--report-out <path>",
    `Output path for extraction report (default: contracts/generated/<surfaceId>.extraction.json)`,
  )
  .option("--schema <path>", "Optional path to the contract schema JSON file")
  .action(async (options) => {
    const exitCode = await runGenerateContractCommand({
      appRoot: options.appRoot,
      surfaceId: options.surface,
      outPath: options.out,
      reportOutPath: options.reportOut,
      schemaPath: options.schema,
    });
    process.exitCode = exitCode;
  });

program
  .command("migrate-color-policy")
  .description("Migrate legacy color contract fields to unified color.policy + color.allowedValues")
  .requiredOption("--contract <path>", "Path to the contract JSON file to migrate")
  .option("--out <path>", "Optional output path (default: overwrite input contract)")
  .option(
    "--include-observed",
    "Union observed colors from static analysis into color.allowedValues",
  )
  .option("--root <path>", "Workspace root for observed descriptor collection")
  .option("--app-root <path>", "App root for observed descriptor collection")
  .option("--surface <id>", "Surface id for observed descriptor collection")
  .action(async (options) => {
    const exitCode = await runMigrateColorPolicyCommand({
      contractPath: options.contract,
      outPath: options.out,
      includeObserved: options.includeObserved === true,
      root: options.root,
      appRoot: options.appRoot,
      surfaceId: options.surface,
    });
    process.exitCode = exitCode;
  });

program
  .command("analyze")
  .description("Analyze a web surface and emit first-run onboarding evidence")
  .option("--url <url>", "Surface URL for remote analysis")
  .option("--app-root <path>", "Local app root for local-root analysis")
  .option("--extract-mode <remote-url|local-root>", "Analysis mode")
  .option("--surface <id>", "Surface identifier override")
  .option("--surface-name <name>", "Surface display name override")
  .option("--surface-kind <marketing|application|unknown>", "Optional surface-kind confirmation override")
  .option("--auth-profile <name>", "Replay an existing auth profile during remote analysis")
  .option("--out <path>", "Output path for the analysis artifact")
  .option("--out-dir <path>", "Output directory for generated analysis artifacts")
  .action(async (options) => {
    const extractMode =
      options.extractMode === "local-root"
        ? "local-root"
        : options.extractMode === "remote-url"
          ? "remote-url"
          : undefined;
    process.exitCode = await runAnalyzeCommand({
      url: options.url,
      appRoot: options.appRoot,
      extractMode,
      surface: options.surface,
      surfaceName: options.surfaceName,
      surfaceKind: options.surfaceKind,
      authProfile: options.authProfile,
      out: options.out,
      outDir: options.outDir,
    });
  });

program
  .command("init")
  .description("Interactive onboarding for first-surface extraction")
  .option("--url <url>", "Surface URL for onboarding")
  .option("--surface <id>", "Surface identifier override")
  .option("--surface-name <name>", "Surface display name override")
  .option("--surface-kind <marketing|application|unknown>", "Optional surface-kind confirmation override")
  .option("--extract-mode <remote-url|local-root>", "Extraction mode")
  .option("--app-root <path>", "Local app root (required for local-root)")
  .option("--auth-profile <name>", "Replay or capture an auth profile for browser-session onboarding")
  .option("--non-interactive", "Run without prompts")
  .option("--verbose", "Show technical onboarding detail")
  .option("--continue-on-gate", "Allow provisional output when remote onboarding resolves to a login or access-denied page")
  .option("--out-dir <path>", "Output directory for generated onboarding artifacts")
  .option("--analysis-out <path>", "Explicit output path for the analysis artifact")
  .option("--draft-out <path>", "Explicit output path for the design-system draft artifact")
  .option("--contract-out <path>", "Explicit output path for the generated contract")
  .option("--report-out <path>", "Explicit output path for the extraction report")
  .action(async (options) => {
    const extractMode =
      options.extractMode === "local-root"
        ? "local-root"
        : options.extractMode === "remote-url"
          ? "remote-url"
          : undefined;
    const exitCode = await runInitCommand({
      url: options.url,
      surface: options.surface,
      surfaceName: options.surfaceName,
      surfaceKind: options.surfaceKind,
      extractMode,
      appRoot: options.appRoot,
      authProfile: options.authProfile,
      nonInteractive: options.nonInteractive === true,
      verbose: options.verbose === true,
      continueOnGate: options.continueOnGate === true,
      outDir: options.outDir,
      analysisOut: options.analysisOut,
      draftOut: options.draftOut,
      contractOut: options.contractOut,
      reportOut: options.reportOut,
    });
    process.exitCode = exitCode;
  });

const auth = program
  .command("auth")
  .description("Manage onboarding browser-session auth profiles");

auth
  .command("capture")
  .description("Capture or refresh a replayable browser-session auth profile")
  .requiredOption("--profile <name>", "Profile name")
  .requiredOption("--url <url>", "URL on the exact host to capture")
  .option("--format <text|json>", "Output format", "text")
  .action(async (options) => {
    process.exitCode = await runAuthCaptureCommand({
      profile: options.profile,
      url: options.url,
      format: options.format === "json" ? "json" : "text",
    });
  });

auth
  .command("list")
  .description("List local auth profiles")
  .option("--format <text|json>", "Output format", "text")
  .action(async (options) => {
    process.exitCode = await runAuthListCommandWithOptions({
      format: options.format === "json" ? "json" : "text",
    });
  });

auth
  .command("test")
  .description("Validate a local auth profile by name")
  .requiredOption("--profile <name>", "Profile name")
  .option("--domain <domain>", "Optional domain scope")
  .option("--url <url>", "Optional URL to test authenticated replay against")
  .option("--format <text|json>", "Output format", "text")
  .action(async (options) => {
    process.exitCode = await runAuthTestCommand({
      profile: options.profile,
      domain: options.domain,
      url: options.url,
      format: options.format === "json" ? "json" : "text",
    });
  });

auth
  .command("clear")
  .description("Clear local auth profiles")
  .option("--profile <name>", "Profile name")
  .option("--domain <domain>", "Domain scope")
  .option("--all", "Clear all profiles")
  .option("--format <text|json>", "Output format", "text")
  .action(async (options) => {
    process.exitCode = await runAuthClearCommand({
      profile: options.profile,
      domain: options.domain,
      all: options.all,
      format: options.format === "json" ? "json" : "text",
    });
  });

auth
  .command("revoke")
  .description("Revoke local auth profiles (alias for clear)")
  .option("--profile <name>", "Profile name")
  .option("--domain <domain>", "Domain scope")
  .option("--all", "Clear all profiles")
  .option("--format <text|json>", "Output format", "text")
  .action(async (options) => {
    process.exitCode = await runAuthClearCommand({
      profile: options.profile,
      domain: options.domain,
      all: options.all,
      format: options.format === "json" ? "json" : "text",
    });
  });

program
  .command("describe")
  .description("Produce descriptors with primitives for pre-emit guard (check-generation-boundaries)")
  .requiredOption("--root <path>", "Project root (e.g. surfaces-webapps)")
  .requiredOption("--contract <path>", "Path to the contract JSON file")
  .requiredOption("--out <path>", "Output path for descriptor JSON array")
  .option("--surface <id...>", "Limit to the provided surface identifiers")
  .option("--schema <path>", "Optional path to contract schema JSON")
  .option("--config <path>", "Path to interfacectl.config.json")
  .action(async (options) => {
    const exitCode = await runDescribeCommand({
      contractPath: options.contract,
      schemaPath: options.schema,
      root: options.root,
      surface: options.surface ?? [],
      out: options.out,
      configPath: options.config,
    });
    process.exitCode = exitCode;
  });

program
  .command("validate-extracted")
  .description("Fail if contract phase0 expectations conflict with extracted reality (Phase 0.5)")
  .requiredOption("--contract <path>", "Path to the declared policy contract JSON")
  .requiredOption("--extracted <path>", "Path to extraction report or generated contract with x_extracted")
  .option("--surface <id>", "Surface id when not inferrable from extracted file")
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--out <path>", "Write output to the provided file path instead of stdout")
  .option("--exit-codes <v1|v2>", "Exit code version (default: v1; v2: 0 success, 10 E0, 30 E2)")
  .action(async (options) => {
    const exitCodeVersion =
      options.exitCodes === "v1" || options.exitCodes === "v2" ? options.exitCodes : undefined;
    const exitCode = await runValidateExtractedCommand({
      contractPath: options.contract,
      extractedPath: options.extracted,
      surfaceId: options.surface,
      format: (options.format ?? "text").toLowerCase() === "json" ? "json" : "text",
      outputPath: options.out,
      exitCodes: exitCodeVersion,
    });
    process.exitCode = exitCode;
  });

async function main(): Promise<void> {
  if (shouldLaunchBareWelcomeFlow(process.argv.slice(2))) {
    process.exitCode = await runBareWelcomeFlow();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
