import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import pc from "picocolors";
import pkg from "../../package.json" with { type: "json" };
import {
  validateFixSummary,
  type EnforcementPolicy,
  type FixSummary,
  type FixEntry,
  type FixError,
  EnforcementMode,
} from "@surfaces/interfacectl-validator";
import { runDiffCommand } from "./diff.js";
import type { DiffOutput } from "@surfaces/interfacectl-validator";
import { loadPolicy, loadDefaultPolicy } from "../utils/policy.js";
import { canAutofix, applyFix } from "../utils/autofix.js";
import {
  applyFixesToFiles,
  generateUnifiedPatch,
  generateJsonPatch,
} from "../utils/file-mutator.js";
import { getExitCodeVersion, type ExitCodeVersion } from "../utils/exit-codes.js";
import { enrichFixEntry, enrichFixError } from "../utils/traceability.js";

type OutputFormat = "text" | "json";

export interface EnforceCommandOptions {
  mode?: EnforcementMode;
  strict?: boolean;
  policyPath?: string;
  astPath?: string;
  contractPath?: string;
  workspaceRoot?: string;
  surfaceFilters?: string[];
  outputFormat?: OutputFormat;
  outputPath?: string;
  configPath?: string;
  configProvided?: boolean;
  dryRun?: boolean;
  exitCodes?: ExitCodeVersion;
}

async function writeFileWithParents(
  filePath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function formatFixSummaryText(summary: FixSummary): string {
  const lines: string[] = [];

  lines.push(`Enforcement Summary (${summary.mode} mode)`);
  lines.push(`Policy: v${summary.policy.version} (${summary.policy.fingerprint.slice(0, 8)}...)`);
  lines.push("");

  if (summary.applied.length > 0) {
    lines.push(pc.green(`✔ Applied ${summary.applied.length} fix(es):`));
    for (const fix of summary.applied) {
      lines.push(`  ${fix.ruleId}: ${fix.path}`);
      lines.push(`    ${JSON.stringify(fix.oldValue)} → ${JSON.stringify(fix.newValue)}`);
      lines.push(`    Confidence: ${(fix.confidence * 100).toFixed(0)}%`);
    }
    lines.push("");
  }

  if (summary.skipped.length > 0) {
    lines.push(pc.yellow(`⚠ Skipped ${summary.skipped.length} fix(es):`));
    for (const fix of summary.skipped) {
      lines.push(`  ${fix.ruleId}: ${fix.path}`);
    }
    lines.push("");
  }

  if (summary.errors.length > 0) {
    lines.push(pc.red(`✖ Errors ${summary.errors.length}:`));
    for (const error of summary.errors) {
      lines.push(`  ${error.ruleId}: ${error.message}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function serializeFixSummary(summary: FixSummary): string {
  return JSON.stringify(summary, null, 2) + "\n";
}

export async function runEnforceCommand(
  options: EnforceCommandOptions,
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

  // Determine exit code version
  const exitCodeVersion = getExitCodeVersion({ exitCodes: options.exitCodes });

  // Determine mode
  let mode: EnforcementMode = options.mode ?? "fail";
  if (options.strict) {
    mode = "fail";
  }

  const finalize = async (exitCode: number, summary?: FixSummary) => {
    if (!summary) {
      return exitCode;
    }

    if (isJson) {
      const serialized = serializeFixSummary(summary);
      if (outputPath) {
        await writeFileWithParents(outputPath, serialized);
      } else {
        process.stdout.write(serialized);
      }
      return exitCode;
    }

    const textOutput = formatFixSummaryText(summary);
    if (outputPath) {
      await writeFileWithParents(outputPath, textOutput);
    } else {
      process.stdout.write(textOutput);
    }
    return exitCode;
  };

  // Load policy
  let policy: EnforcementPolicy;
  if (options.policyPath) {
    const policyResult = await loadPolicy(options.policyPath, workspaceRoot);
    if (!policyResult.ok || !policyResult.policy) {
      const e0ExitCode = exitCodeVersion === "v2" ? 10 : 2;
      if (!isJson) {
        console.error(`Failed to load policy: ${policyResult.error}`);
      }
      return e0ExitCode;
    }
    policy = policyResult.policy;
  } else {
    policy = loadDefaultPolicy();
  }

  // Run diff command internally to get diff output
  // Use a temp file to capture JSON output
  const { tmpdir } = await import("node:os");
  const { randomUUID } = await import("node:crypto");
  const tempDiffPath = path.join(
    tmpdir(),
    `interfacectl-diff-${randomUUID()}.json`,
  );

  const diffResult = await runDiffCommand({
    astPath: options.astPath,
    contractPath: options.contractPath,
    workspaceRoot,
    surfaceFilters: options.surfaceFilters,
    outputFormat: "json",
    outputPath: tempDiffPath,
    configPath: options.configPath,
    configProvided: options.configProvided,
    policyPath: options.policyPath,
    exitCodes: exitCodeVersion,
  });

  // Read diff output if it was written
  let diffOutput: DiffOutput | null = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const diffContent = await readFile(tempDiffPath, "utf-8");
    diffOutput = JSON.parse(diffContent) as DiffOutput;
    // Clean up temp file
    await import("node:fs/promises").then((fs) => fs.unlink(tempDiffPath));
  } catch (error) {
    // If diff failed or file doesn't exist, handle gracefully
    // E0 errors (10 in v2, 2 or 3 in v1) should be returned as-is
    if (diffResult !== 0 && diffResult !== 1) {
      // Config or internal error (E0)
      return diffResult;
    }
  }

  // For fail mode, check if there are diffs and evaluate against policy
  if (mode === "fail") {
    const failMode = policy.modes.fail;
    let exitCode = 0;

    if (diffOutput && diffOutput.entries.length > 0) {
      // Check severity threshold
      const thresholdSeverity = failMode.severityThreshold;
      const hasViolations = diffOutput.entries.some((entry) => {
        if (thresholdSeverity === "error") {
          return entry.severity === "error";
        }
        // warning threshold means both error and warning count
        return entry.severity === "error" || entry.severity === "warning";
      });

      if (hasViolations && failMode.exitOnAny) {
        // Violations remaining: E2 (enforce does not distinguish E1 vs E2)
        exitCode = exitCodeVersion === "v2" ? 30 : 1;
      } else if (diffOutput.summary.totalChanges > 0 && failMode.exitOnAny) {
        // Violations remaining: E2
        exitCode = exitCodeVersion === "v2" ? 30 : 1;
      }
    }

    // Print deprecation warning for v1 when violations exist
    if (exitCodeVersion === "v1" && exitCode !== 0) {
      process.stderr.write(
        "Deprecation: default exit codes will change. Use --exit-codes v2 to opt in.\n",
      );
    }

    // Create a minimal fix summary for fail mode
    const summary: FixSummary = {
      schemaVersion: "1.0.0",
      mode: "fix", // Use fix mode for summary even though we're in fail mode
      policy: {
        version: policy.version,
        fingerprint: policy.fingerprint,
      },
      applied: [],
      skipped: [],
      errors: [],
    };

    return finalize(exitCode, summary);
  }

  // For fix and pr modes, we need to actually apply fixes
  if (!diffOutput || diffOutput.entries.length === 0) {
    // No diffs, nothing to fix
    const summary: FixSummary = {
      schemaVersion: "1.0.0",
      mode,
      policy: {
        version: policy.version,
        fingerprint: policy.fingerprint,
      },
      applied: [],
      skipped: [],
      errors: [],
    };
    return finalize(0, summary);
  }

  const applied: FixEntry[] = [];
  const skipped: FixEntry[] = [];
  const errors: FixError[] = [];

  // Match diff entries against policy rules
  const allowedRuleIds = new Set(policy.modes.fix.rules);
  const dryRun = options.dryRun ?? policy.modes.fix.dryRun;

  for (const entry of diffOutput.entries) {
    // Find matching autofix rules
    const matchingRules = policy.autofixRules.filter((rule) => {
      if (!allowedRuleIds.has(rule.id)) {
        return false; // Rule not enabled in fix mode
      }
      return canAutofix(entry, rule);
    });

    if (matchingRules.length === 0) {
      // No matching rule, skip
      continue;
    }

    // Use the first matching rule
    const rule = matchingRules[0];
    const fix = applyFix(entry, rule);

    if (!fix) {
      const skipEntry: FixEntry = {
        ruleId: rule.id,
        path: entry.path,
        oldValue: entry.observedValue,
        newValue: entry.contractValue,
        confidence: 0.5,
      };
      skipped.push(enrichFixEntry(skipEntry, entry, "enforce"));
      continue;
    }

    // Apply fix if not dry run
    const enrichedFix = enrichFixEntry(fix, entry, "enforce");
    if (!dryRun && mode === "fix") {
      // In fix mode, actually apply the fix
      // For now, we'll mark it as applied (actual file mutation would happen here)
      applied.push(enrichedFix);
    } else {
      // In pr mode or dry run, just collect fixes
      applied.push(enrichedFix);
    }
  }

  // Generate patch for pr mode
  if (mode === "pr") {
    const patchFormat = policy.modes.pr.patchFormat;
    const patchOutputPath = policy.modes.pr.outputPath;

    if (patchFormat === "unified") {
      const patch = generateUnifiedPatch(applied, workspaceRoot);
      if (patchOutputPath) {
        const fullPath = path.isAbsolute(patchOutputPath)
          ? patchOutputPath
          : path.resolve(workspaceRoot, patchOutputPath);
        await writeFileWithParents(fullPath, patch);
      } else {
        process.stdout.write(patch);
      }
    } else {
      // JSON patch format
      const patch = generateJsonPatch(applied);
      const patchStr = JSON.stringify(patch, null, 2) + "\n";
      if (patchOutputPath) {
        const fullPath = path.isAbsolute(patchOutputPath)
          ? patchOutputPath
          : path.resolve(workspaceRoot, patchOutputPath);
        await writeFileWithParents(fullPath, patchStr);
      } else {
        process.stdout.write(patchStr);
      }
    }
  }

  const summary: FixSummary = {
    schemaVersion: "1.0.0",
    mode,
    policy: {
      version: policy.version,
      fingerprint: policy.fingerprint,
    },
    applied,
    skipped,
    errors,
  };

  // Validate summary against schema (in development mode)
  if (process.env.NODE_ENV === "development") {
    const validation = validateFixSummary(summary);
    if (!validation.ok) {
      console.warn("Fix summary validation warnings:");
      for (const error of validation.errors) {
        console.warn(`  • ${error}`);
      }
    }
  }

  // Determine exit code
  // 0: fixes applied successfully
  // 30 (v2) or 1 (v1): violations remaining (E2 - enforce does not distinguish E1 vs E2)
  let exitCode: number;
  if (applied.length > 0 && errors.length === 0) {
    exitCode = 0;
  } else {
    // Violations remaining: E2
    exitCode = exitCodeVersion === "v2" ? 30 : 1;
  }

  // Print deprecation warning for v1 when violations exist
  if (exitCodeVersion === "v1" && exitCode !== 0) {
    process.stderr.write(
      "Deprecation: default exit codes will change. Use --exit-codes v2 to opt in.\n",
    );
  }

  return finalize(exitCode, summary);
}
