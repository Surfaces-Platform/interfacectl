#!/usr/bin/env node
import { Command } from "commander";
import { runValidateCommand } from "./commands/validate.js";
import { runDiffCommand } from "./commands/diff.js";
import { runEnforceCommand } from "./commands/enforce.js";
import { runCompileCommand } from "./commands/compile.js";
import { runGenerateContractCommand } from "./commands/generate-contract.js";
import { runValidateExtractedCommand } from "./commands/validate-extracted.js";
import { runDescribeCommand } from "./commands/describe.js";
import pkg from "../package.json" with { type: "json" };
const program = new Command();
program
    .name("interfacectl")
    .description("Interface contract tooling for Surfaces")
    .version(pkg.version ?? "0.0.0");
program
    .command("validate")
    .description("Validate configured surfaces against the shared interface contract")
    .option("--contract <path>", "Path to the contract JSON file")
    .option("--schema <path>", "Optional path to the contract schema JSON file")
    .option("--config <path>", "Optional path to the interfacectl config JSON file (defaults to interfacectl.config.json)")
    .option("--root <path>", "Project root (defaults to current working directory)")
    .option("--workspace-root <path>", "Workspace root (defaults to current working directory)")
    .option("--surface <id...>", "Limit validation to the provided surface identifiers")
    .option("--json", "Emit machine-readable JSON instead of human-readable text output")
    .option("--format <format>", "Output format (text|json)")
    .option("--out <path>", "Write output to the provided file path instead of stdout")
    .option("--exit-codes <v1|v2>", "Exit code version (default: v1, use v2 for new contract)")
    .action(async (options) => {
    const env = process.env;
    const requestedRoot = options.root ?? options.workspaceRoot ?? env.SURFACES_ROOT;
    const workspaceRoot = typeof requestedRoot === "string" && requestedRoot.length > 0
        ? requestedRoot
        : undefined;
    const requestedContract = options.contract ?? env.SURFACES_CONTRACT ?? undefined;
    const contractPath = typeof requestedContract === "string" && requestedContract.length > 0
        ? requestedContract
        : "contracts/surfaces.web.contract.json";
    const requestedConfig = options.config ?? env.SURFACES_CONFIG ?? undefined;
    const formatInput = (options.format ?? (options.json ? "json" : undefined))?.toLowerCase();
    const outputFormat = formatInput === "json" ? "json" : formatInput === "text" ? "text" : "text";
    if (formatInput &&
        formatInput !== "text" &&
        formatInput !== "json") {
        console.error(`Invalid format "${options.format}". Expected "text" or "json".`);
        process.exitCode = 1;
        return;
    }
    const exitCodeVersion = options.exitCodes === "v1" || options.exitCodes === "v2"
        ? options.exitCodes
        : undefined;
    const exitCode = await runValidateCommand({
        contractPath,
        schemaPath: options.schema,
        workspaceRoot,
        surfaceFilters: options.surface ?? [],
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
    .option("--config <path>", "Optional path to the interfacectl config JSON file (defaults to interfacectl.config.json)")
    .option("--root <path>", "Project root (defaults to current working directory)")
    .option("--workspace-root <path>", "Workspace root (defaults to current working directory)")
    .option("--surface <id...>", "Limit validation to the provided surface identifiers")
    .option("--json", "Emit machine-readable JSON instead of human-readable text output")
    .option("--format <format>", "Output format (text|json)")
    .option("--out <path>", "Write output to the provided file path instead of stdout")
    .option("--no-normalize", "Disable normalization (for debugging)")
    .option("--rename-threshold <0-1>", "Rename detection threshold (default: 0.8)", parseFloat)
    .option("--policy <path>", "Optional policy path (for policy metadata in output)")
    .option("--exit-codes <v1|v2>", "Exit code version (default: v1, use v2 for new contract)")
    .action(async (options) => {
    const env = process.env;
    const requestedRoot = options.root ?? options.workspaceRoot ?? env.SURFACES_ROOT;
    const workspaceRoot = typeof requestedRoot === "string" && requestedRoot.length > 0
        ? requestedRoot
        : undefined;
    const requestedContract = options.contract ?? env.SURFACES_CONTRACT ?? undefined;
    const contractPath = typeof requestedContract === "string" && requestedContract.length > 0
        ? requestedContract
        : "contracts/surfaces.web.contract.json";
    const requestedConfig = options.config ?? env.SURFACES_CONFIG ?? undefined;
    const formatInput = (options.format ?? (options.json ? "json" : undefined))?.toLowerCase();
    const outputFormat = formatInput === "json" ? "json" : formatInput === "text" ? "text" : "text";
    if (formatInput &&
        formatInput !== "text" &&
        formatInput !== "json") {
        console.error(`Invalid format "${options.format}". Expected "text" or "json".`);
        process.exitCode = 1;
        return;
    }
    const exitCodeVersion = options.exitCodes === "v1" || options.exitCodes === "v2"
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
    const requestedRoot = options.root ?? env.SURFACES_ROOT;
    const workspaceRoot = typeof requestedRoot === "string" && requestedRoot.length > 0
        ? requestedRoot
        : undefined;
    const requestedContract = options.contract ?? env.SURFACES_CONTRACT ?? undefined;
    const requestedConfig = options.config ?? env.SURFACES_CONFIG ?? undefined;
    const formatInput = (options.format ?? (options.json ? "json" : undefined))?.toLowerCase();
    const outputFormat = formatInput === "json" ? "json" : formatInput === "text" ? "text" : "text";
    if (formatInput &&
        formatInput !== "text" &&
        formatInput !== "json") {
        console.error(`Invalid format "${options.format}". Expected "text" or "json".`);
        process.exitCode = 1;
        return;
    }
    const exitCodeVersion = options.exitCodes === "v1" || options.exitCodes === "v2"
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
    const exitCode = await runCompileCommand({
        contractPath: options.contract,
        outDir: options.out,
        schemaPath: options.schema,
        format: options.format,
    }, pkg.version ?? "0.0.0");
    process.exitCode = exitCode;
});
program
    .command("generate-contract")
    .description("Extract a contract from a Next.js app (Phase 0: extraction only)")
    .requiredOption("--app-root <path>", "Path to the Next.js app root (directory containing app/)")
    .requiredOption("--surface <id>", "Surface identifier (e.g. surfaces-web)")
    .option("--out <path>", `Output path for contract JSON (default: contracts/generated/<surfaceId>.contract.json)`)
    .option("--report-out <path>", `Output path for extraction report (default: contracts/generated/<surfaceId>.extraction.json)`)
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
    .option("--exit-codes <v1|v2>", "Exit code version (default: v1; v2: 0 success, 10 E0, 30 E2)")
    .action(async (options) => {
    const exitCodeVersion = options.exitCodes === "v1" || options.exitCodes === "v2" ? options.exitCodes : undefined;
    const exitCode = await runValidateExtractedCommand({
        contractPath: options.contract,
        extractedPath: options.extracted,
        surfaceId: options.surface,
        format: (options.format ?? "text").toLowerCase() === "json" ? "json" : "text",
        exitCodes: exitCodeVersion,
    });
    process.exitCode = exitCode;
});
program.parseAsync(process.argv).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
