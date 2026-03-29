import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pc from "picocolors";
import pkg from "../../package.json" with { type: "json" };
import {
  validateContractStructure,
  getBundledContractSchema,
  validateDiffOutput,
  type InterfaceContract,
} from "@surfaces/interfacectl-validator";
import {
  collectSurfaceDescriptors,
  type DescriptorIssue,
} from "../descriptors/static-analysis.js";
import { normalizeContract, normalizeDescriptor } from "../utils/normalize.js";
import {
  compareContractToDescriptor,
  buildDiffPath,
} from "../utils/compare.js";
import { detectAllDriftRisks, detectDiffNoise } from "../utils/drift-detection.js";
import type {
  DiffOutput,
  DiffEntry,
  DriftRisk,
  EnforcementPolicy,
} from "@surfaces/interfacectl-validator";
import { loadPolicy } from "../utils/policy.js";
import { getExitCodeVersion, type ExitCodeVersion } from "../utils/exit-codes.js";
import { getMaxSeverity } from "../utils/violation-classifier.js";
import { applyPolicySeverityOverrides } from "../utils/apply-policy-severity.js";
import { enrichDiffEntry } from "../utils/traceability.js";
import { resolveUiAstInput } from "../utils/ui-ast.js";

type OutputFormat = "text" | "json";

interface InterfacectlConfig {
  surfaceRoots?: Record<string, string>;
}

export interface DiffCommandOptions {
  astPath?: string;
  contractPath?: string;
  schemaPath?: string;
  workspaceRoot?: string;
  surfaceFilters?: string[];
  outputFormat?: OutputFormat;
  outputPath?: string;
  configPath?: string;
  configProvided?: boolean;
  normalize?: boolean;
  renameThreshold?: number;
  policyPath?: string;
  exitCodes?: ExitCodeVersion;
}

interface ConfigLoadResult {
  ok: boolean;
  config?: InterfacectlConfig;
  error?: string;
  reason?: "missing" | "invalid";
}

async function loadConfigFile(configPath: string): Promise<ConfigLoadResult> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as InterfacectlConfig;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Config must be a JSON object");
    }
    return { ok: true, config: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        reason: "missing",
        error: `Config file not found at ${configPath}`,
      };
    }
    const message =
      error instanceof SyntaxError
        ? `Config file at ${configPath} is not valid JSON: ${error.message}`
        : `Failed to read config file at ${configPath}: ${
            (error as Error).message
          }`;
    return {
      ok: false,
      reason: "invalid",
      error: message,
    };
  }
}

async function loadJson(
  filePath: string,
  label: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const message = `${label} file not found at ${filePath}`;
      return { ok: false, error: message };
    }
    return {
      ok: false,
      error: `Failed to read ${label} file at ${filePath}: ${
        (error as Error).message
      }`,
    };
  }
}

async function writeFileWithParents(
  filePath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function extractContractVersion(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "version" in (value as Record<string, unknown>)
  ) {
    const candidate = (value as { version?: unknown }).version;
    return typeof candidate === "string" ? candidate : null;
  }
  return null;
}

/**
 * Get exit code for diff command based on entries and version.
 * v1: entries.length === 0 ? 0 : 1 (backward compatible, E3 does not exist)
 * v2: 0 (no entries), 30 (blocking drift), 40 (E3: non-blocking drift)
 */
function getDiffExitCode(
  entries: DiffEntry[],
  exitCodeVersion: ExitCodeVersion,
): number {
  if (entries.length === 0) {
    return 0;
  }

  if (exitCodeVersion === "v1") {
    // v1: backward compatible - any entries → exit 1
    return 1;
  }

  // v2: determine based on maxSeverity
  const maxSeverity = getMaxSeverity(entries);
  if (!maxSeverity) {
    return 0;
  }

  if (maxSeverity === "info") {
    // E3: non-blocking drift (all entries are info)
    return 40;
  }

  // E2: blocking drift (error or warning entries)
  return 30;
}

function sortDiffEntries(entries: DiffEntry[]): DiffEntry[] {
  return [...entries].sort((a, b) => {
    // Sort by surfaceId (asc, nulls last)
    if (a.surfaceId !== b.surfaceId) {
      if (!a.surfaceId) return 1;
      if (!b.surfaceId) return -1;
      return a.surfaceId.localeCompare(b.surfaceId);
    }
    // Then by path (asc)
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    // Then by type (asc)
    return a.type.localeCompare(b.type);
  });
}

function ensureRelativePaths(
  output: DiffOutput,
  workspaceRoot: string,
): DiffOutput {
  const contractPath = output.contract.path;
  const relativeContractPath = path.isAbsolute(contractPath)
    ? path.relative(workspaceRoot, contractPath)
    : contractPath;

  const observedRoot = output.observed.root;
  let relativeObservedRoot = path.isAbsolute(observedRoot)
    ? path.relative(workspaceRoot, observedRoot)
    : observedRoot;
  if (!relativeObservedRoot) {
    relativeObservedRoot = ".";
  }

  return {
    ...output,
    contract: {
      ...output.contract,
      path: relativeContractPath,
    },
    observed: {
      ...output.observed,
      root: relativeObservedRoot,
    },
  };
}

function serializeDiffOutput(output: DiffOutput): string {
  // Sort entries deterministically
  const sortedOutput = {
    ...output,
    entries: sortDiffEntries(output.entries),
  };
  // Ensure relative paths
  const relativeOutput = ensureRelativePaths(
    sortedOutput,
    process.cwd(),
  );
  return JSON.stringify(relativeOutput, null, 2) + "\n";
}

function formatDiffText(output: DiffOutput): string {
  const lines: string[] = [];

  lines.push(`Diff between contract and observed artifacts`);
  lines.push(`Contract: ${output.contract.path} (v${output.contract.version})`);
  lines.push(`Observed: ${output.observed.root}`);
  lines.push("");

  if (output.normalization.enabled) {
    if (
      output.normalization.reorderedPaths.length > 0 ||
      output.normalization.strippedPaths.length > 0
    ) {
      lines.push("Normalization:");
      if (output.normalization.reorderedPaths.length > 0) {
        lines.push(
          `  Reordered paths: ${output.normalization.reorderedPaths.length}`,
        );
      }
      if (output.normalization.strippedPaths.length > 0) {
        lines.push(
          `  Stripped paths: ${output.normalization.strippedPaths.length}`,
        );
      }
      lines.push("");
    }
  }

  if (output.summary.totalChanges === 0) {
    lines.push(pc.green("✔ No differences found"));
    return lines.join("\n") + "\n";
  }

  lines.push(
    pc.red(
      `✖ ${output.summary.totalChanges} difference(s) found`,
    ),
  );
  lines.push(
    `  Added: ${output.summary.byType.added}, Removed: ${output.summary.byType.removed}, Modified: ${output.summary.byType.modified}, Renamed: ${output.summary.byType.renamed}`,
  );
  lines.push("");

  // Group entries by surface
  const entriesBySurface = new Map<string, DiffEntry[]>();
  for (const entry of output.entries) {
    const surfaceId = entry.surfaceId ?? "unknown";
    if (!entriesBySurface.has(surfaceId)) {
      entriesBySurface.set(surfaceId, []);
    }
    entriesBySurface.get(surfaceId)!.push(entry);
  }

  for (const [surfaceId, entries] of entriesBySurface.entries()) {
    lines.push(`Surface: ${surfaceId}`);
    for (const entry of entries) {
      const typeColor =
        entry.type === "added"
          ? pc.green
          : entry.type === "removed"
            ? pc.red
            : entry.type === "modified"
              ? pc.yellow
              : pc.blue;
      lines.push(
        `  ${typeColor(entry.type)} ${entry.path} (${entry.severity})`,
      );
      if (entry.contractValue !== undefined) {
        lines.push(`    Contract: ${JSON.stringify(entry.contractValue)}`);
      }
      if (entry.observedValue !== undefined) {
        lines.push(`    Observed: ${JSON.stringify(entry.observedValue)}`);
      }
      if (entry.rule) {
        lines.push(`    Rule: ${entry.rule}`);
      }
    }
    lines.push("");
  }

  if (output.driftRisks && output.driftRisks.length > 0) {
    lines.push("Drift Risks:");
    for (const risk of output.driftRisks) {
      const severityColor =
        risk.severity === "error"
          ? pc.red
          : risk.severity === "warning"
            ? pc.yellow
            : pc.blue;
      lines.push(
        `  ${severityColor(risk.severity)} [${risk.category}] ${risk.message}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export async function runDiffCommand(
  options: DiffCommandOptions,
): Promise<number> {
  const workspaceRoot = path.resolve(
    options.workspaceRoot ?? process.cwd(),
  );
  const outputFormat: OutputFormat = options.outputFormat ?? "text";
  const isJson = outputFormat === "json";
  const outputPath = options.outputPath
    ? path.isAbsolute(options.outputPath)
      ? options.outputPath
      : path.resolve(workspaceRoot, options.outputPath)
    : undefined;
  const configInput =
    options.configPath ?? "interfacectl.config.json";
  const configWasExplicit = Boolean(options.configProvided);
  const configPath = path.isAbsolute(configInput)
    ? configInput
    : path.resolve(workspaceRoot, configInput);
  const normalizeEnabled = options.normalize !== false;
  const renameThreshold = options.renameThreshold ?? 0.8;

  // Determine exit code version
  const exitCodeVersion = getExitCodeVersion({ exitCodes: options.exitCodes });

  const finalize = async (exitCode: number, output?: DiffOutput) => {
    if (!output) {
      return exitCode;
    }

    if (isJson) {
      const serialized = serializeDiffOutput(output);
      if (outputPath) {
        await writeFileWithParents(outputPath, serialized);
      } else {
        process.stdout.write(serialized);
      }
      return exitCode;
    }

    const textOutput = formatDiffText(output);
    if (outputPath) {
      await writeFileWithParents(outputPath, textOutput);
    } else {
      process.stdout.write(textOutput);
    }
    return exitCode;
  };

  const resolvedInput = await resolveUiAstInput({
    workspaceRoot,
    astPath: options.astPath,
    contractPath: options.contractPath,
    schemaPath: options.schemaPath,
  });
  if ("error" in resolvedInput) {
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    if (isJson) {
      const errorOutput: DiffOutput = {
        schemaVersion: "1.0.0",
        tool: { name: "interfacectl", version: pkg.version ?? "0.0.0" },
        contract: { path: options.astPath ?? options.contractPath ?? "unknown", version: "unknown" },
        observed: { root: workspaceRoot },
        normalization: { enabled: normalizeEnabled, reorderedPaths: [], strippedPaths: [] },
        summary: {
          totalChanges: 0,
          byType: { added: 0, removed: 0, modified: 0, renamed: 0 },
          bySeverity: { error: 0, warning: 0, info: 0 },
        },
        entries: [],
      };
      await finalize(e0ExitCode, errorOutput);
    } else {
      console.error(resolvedInput.error);
    }
    return e0ExitCode;
  }

  for (const warning of resolvedInput.warnings) {
    if (!isJson) {
      console.error(`Warning: ${warning}`);
    }
  }
  const contractPath = resolvedInput.sourcePath;
  const contract = resolvedInput.derivedContract;

  // Load config
  const configResult = await loadConfigFile(configPath);
  const surfaceRootMap = new Map<string, string>();
  if (configResult.ok && configResult.config) {
    for (const [surfaceId, surfaceRoot] of Object.entries(
      configResult.config.surfaceRoots ?? {},
    )) {
      surfaceRootMap.set(surfaceId, surfaceRoot);
    }
  } else if (configResult.ok === false && configResult.reason !== "missing") {
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    if (!isJson) {
      console.error(`Failed to load config: ${configResult.error}`);
    }
    return e0ExitCode;
  }

  // Load policy if provided
  let policy: EnforcementPolicy | undefined;
  if (options.policyPath) {
    const policyResult = await loadPolicy(options.policyPath, workspaceRoot);
    if (policyResult.ok && policyResult.policy) {
      policy = policyResult.policy;
    }
  }

  // Collect surface descriptors
  const surfaceFilters = new Set(
    (options.surfaceFilters ?? []).map((value) => value.trim()),
  );

  const descriptorResult = await collectSurfaceDescriptors({
    workspaceRoot,
    contract,
    surfaceFilters,
    surfaceRootMap,
  });

  if (descriptorResult.errors.length > 0) {
    const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
    if (!isJson) {
      console.error("Surface descriptor errors:");
      for (const error of descriptorResult.errors) {
        console.error(`  • ${error.message}`);
      }
    }
    return e0ExitCode;
  }

  // Normalize contract and descriptors
  const normalizedContract = normalizeEnabled
    ? normalizeContract(contract)
    : { contract, metadata: { reorderedPaths: [], strippedPaths: [] } };

  const normalizedDescriptors = descriptorResult.descriptors.map((desc) =>
    normalizeEnabled
      ? normalizeDescriptor(desc)
      : { descriptor: desc, metadata: { reorderedPaths: [], strippedPaths: [] } },
  );

  // Compare contract to descriptors
  const allEntries: DiffEntry[] = [];
  for (const normalizedDesc of normalizedDescriptors) {
    const entries = compareContractToDescriptor(
      normalizedContract,
      normalizedDesc,
      normalizedDesc.descriptor.surfaceId,
    );
    allEntries.push(...entries);
  }

  // Apply policy severity overrides (deterministic, runs before noise filtering)
  const entriesWithOverrides = applyPolicySeverityOverrides(allEntries, policy);

  // Filter diff-noise entries (formatting/reorder-only changes)
  const filteredEntries = detectDiffNoise(entriesWithOverrides);

  // Enrich entries with traceability fields (Phase 2)
  const enrichedEntries = sortDiffEntries(
    filteredEntries.map((e) => enrichDiffEntry(e, "diff")),
  );

  // Build output
  const output: DiffOutput = {
    schemaVersion: "1.0.0",
    tool: { name: "interfacectl", version: pkg.version ?? "0.0.0" },
    ...(policy
      ? {
          policy: {
            version: policy.version,
            fingerprint: policy.fingerprint,
          },
        }
      : {}),
    contract: { path: contractPath, version: contract.version },
    observed: { root: workspaceRoot },
    normalization: {
      enabled: normalizeEnabled,
      reorderedPaths: normalizedContract.metadata.reorderedPaths,
      strippedPaths: normalizedContract.metadata.strippedPaths,
    },
    summary: {
      totalChanges: enrichedEntries.length,
      byType: {
        added: enrichedEntries.filter((e) => e.type === "added").length,
        removed: enrichedEntries.filter((e) => e.type === "removed").length,
        modified: enrichedEntries.filter((e) => e.type === "modified").length,
        renamed: enrichedEntries.filter((e) => e.type === "renamed").length,
      },
      bySeverity: {
        error: enrichedEntries.filter((e) => e.severity === "error").length,
        warning: enrichedEntries.filter((e) => e.severity === "warning").length,
        info: enrichedEntries.filter((e) => e.severity === "info").length,
      },
    },
    entries: enrichedEntries,
    repro: {
      command: `interfacectl diff --contract "${contractPath}" --root "${workspaceRoot}"`,
    },
  };

  // Detect drift risks and add to output
  const driftRisks = detectAllDriftRisks(output, policy);
  if (driftRisks.length > 0) {
    output.driftRisks = driftRisks;
  }

  // Validate output against schema (in development mode)
  if (process.env.NODE_ENV === "development") {
    const validation = validateDiffOutput(output);
    if (!validation.ok) {
      console.warn("Diff output validation warnings:");
      for (const error of validation.errors) {
        console.warn(`  • ${error}`);
      }
    }
  }

  // Determine exit code based on enriched entries and severity
  const exitCode = getDiffExitCode(enrichedEntries, exitCodeVersion);

  // Print deprecation warning for v1 when diffs exist
  if (exitCodeVersion === "v1" && enrichedEntries.length > 0) {
    process.stderr.write(
      "Deprecation: default exit codes will change. Use --exit-codes v2 to opt in.\n",
    );
  }

  return finalize(exitCode, output);
}
